# Jenkins + SonarQube: tests with coverage

The app's side is in the repository: `npm run test:coverage` runs every test with coverage (c8) and writes
`coverage/lcov.info`; `sonar-project.properties` tells SonarQube where that file is and what counts as source and tests.
The pipeline only has to run them in this order.

## Pipeline stages (Jenkinsfile)

```groovy
pipeline {
  agent any
  tools { nodejs 'node20' }            // any Node.js 20 or newer
  stages {
    stage('Install') { steps { sh 'node -v && npm ci' } }                 // installs devDependencies (c8)
    stage('Test + coverage') { steps { sh 'npm run test:coverage' } }     // writes coverage/lcov.info
    stage('Coverage report exists') { steps { sh 'test -s coverage/lcov.info' } }
    stage('SonarQube') {
      steps { withSonarQubeEnv('SonarQube') { sh 'sonar-scanner' } }      // reads sonar-project.properties
    }
    stage('Quality gate') { steps { timeout(time: 10, unit: 'MINUTES') { waitForQualityGate abortPipeline: true } } }
  }
}
```

Names in quotes (`node20`, `SonarQube`) are whatever the Jenkins server calls its Node.js tool and SonarQube server.
If the SonarQube project key is not `AIdentify`, pass it: `sonar-scanner -Dsonar.projectKey=<key>`.

Optional: set `DATABASE_URL_TEST` to an empty PostgreSQL database to also run the PostgreSQL tests (they use their own
schema and remove it afterwards).

## What SonarQube counts

- Source: everything except `node_modules/`, `coverage/`, `data/`, `public/`, `zips/` and `test/` (tests are tests).
- Coverage is measured for the server code (`lib/`, `server.js`, `api/`). Not counted for coverage (still scanned for
  bugs and security issues): browser pages (`*.html`, `home.js`, `landing-v2.js`), `clients/` (Android, desktop),
  `scripts/` (admin commands), and the adapters that only run against a real outside system — Chrome
  (`lib/browser.js`, `lib/remote-browser.js`, `lib/xbrowser.js`), Slack's live socket (`lib/slack.js`), the build
  sandbox (`lib/factory.js`) and cloudflared (`lib/media-tunnel.js`). The browser end-to-end suites cover those.

## Locally

```
npm install
npm run test:coverage        # summary at the end; HTML report in coverage/lcov-report/index.html
```
