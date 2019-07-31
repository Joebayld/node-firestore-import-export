#!/usr/bin/env node
import * as commander from 'commander';
import * as prompt from 'prompt';
import * as colors from 'colors';
import * as process from 'process';
import * as fs from 'fs';
import {firestoreImport} from '../lib';
import {getCredentialsFromFile, getDBReferenceFromPath, getFirestoreDBReference} from '../lib/firestore-helpers';
import * as loadJsonFile from 'load-json-file';

const packageInfo = require('../../package.json');

const accountCredentialsEnvironmentKey = 'GOOGLE_APPLICATION_CREDENTIALS';
const accountCredentialsPathParamKey = 'accountCredentials';
const accountCredentialsPathParamDescription = 'path to Google Cloud account credentials JSON file. If missing, will look ' +
  `at the ${accountCredentialsEnvironmentKey} environment variable for the path.`;

const backupFileParamKey = 'backupFile';
const backupFileParamDescription = 'Filename to store backup. (e.g. backups/full-backup.json).';

const nodePathParamKey = 'nodePath';
const nodePathParamDescription = 'Path to database node (has to be a collection) where import will to start (e.g. collectionA/docB/collectionC).' +
  ' Imports at root level if missing.';

const yesToImportParamKey = 'yes';
const yesToImportParamDescription = 'Unattended import without confirmation (like hitting "y" from the command line).';

commander.version(packageInfo.version)
  .option(`-a, --${accountCredentialsPathParamKey} <path>`, accountCredentialsPathParamDescription)
  .option(`-b, --${backupFileParamKey} <path>`, backupFileParamDescription)
  .option(`-n, --${nodePathParamKey} <path>`, nodePathParamDescription)
  .option(`-y, --${yesToImportParamKey}`, yesToImportParamDescription)
  .parse(process.argv);

let accountCredentialsPath = commander[accountCredentialsPathParamKey] || process.env[accountCredentialsEnvironmentKey];
if (!accountCredentialsPath) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(accountCredentialsPathParamKey) + ' - ' + accountCredentialsPathParamDescription);
  commander.help();
  process.exit(1);
}

if (!fs.existsSync(accountCredentialsPath)) {
  console.log(colors.bold(colors.red('Account credentials file does not exist: ')) + colors.bold(accountCredentialsPath));
  commander.help();
  process.exit(1);
}

const backupFile = commander[backupFileParamKey];
if (!backupFile) {
  console.log(colors.bold(colors.red('Missing: ')) + colors.bold(backupFileParamKey) + ' - ' + backupFileParamDescription);
  commander.help();
  process.exit(1);
}

if (!fs.existsSync(backupFile)) {
  console.log(colors.bold(colors.red('Backup file does not exist: ')) + colors.bold(backupFile));
  commander.help();
  process.exit(1);
}

const nodePath = commander[nodePathParamKey];

const importPathPromise = getCredentialsFromFile(accountCredentialsPath)
  .then(credentials => {
    const db = getFirestoreDBReference(credentials);
    return getDBReferenceFromPath(db, nodePath);
  });

const unattendedConfirmation = commander[yesToImportParamKey];

Promise.all([loadJsonFile(backupFile), importPathPromise, getCredentialsFromFile(accountCredentialsPath)])
  .then((res) => {
    if (unattendedConfirmation) {
      return res;
    }
    const [data, pathReference, credentials] = res;
    const nodeLocation = (<FirebaseFirestore.DocumentReference | FirebaseFirestore.CollectionReference>pathReference)
      .path || '[database root]';
    const projectID = (credentials as any).project_id;
    const importText = `About to import data '${backupFile}' to the '${projectID}' firestore at '${nodeLocation}'.`;
    console.log(`\n\n${colors.bold(colors.blue(importText))}`);
    console.log(colors.bgYellow(colors.blue(' === Warning: This will overwrite existing data. Do you want to proceed? === ')));
    return new Promise((resolve, reject) => {
      prompt.message = 'firestore-import';
      prompt.start();
      prompt.get({
        properties: {
          response: {
            description: colors.red(`Proceed with import? [y/N] `),
          },
        },
      }, (err: Error, result: any) => {
        if (err) {
          return reject(err);
        }
        switch (result.response.trim().toLowerCase()) {
          case 'y':
            resolve(res);
            break;
          default:
            reject('Import aborted.');
        }
      });
    });
  })
  .then((res: any) => {
    const [data, pathReference] = res;
    return firestoreImport(data, pathReference);
  })
  .then(() => {
    console.log(colors.bold(colors.green('All done 🎉')));
  })
  .catch((error) => {
    if (error instanceof Error) {
      console.log(colors.red(`${error.name}: ${error.message}`));
      console.log(colors.red(error.stack as string));
      process.exit(1);
    } else {
      console.log(colors.red(error));
    }
  });


