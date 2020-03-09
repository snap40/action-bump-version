import * as core from '@actions/core';
import fs from 'fs';
import {WebhookPayloadPullRequest} from '@octokit/webhooks';
import childProcess from 'child_process';
import path from 'path';
import simplegit, {SimpleGit} from 'simple-git/promise';

const VERSION_BUMP_TRIGGERS = ['#major', '#minor', '#patch'];

async function run(): Promise<void> {
    const git: SimpleGit = simplegit();

    await git.addConfig('user.name', core.getInput('username'));
    await git.addConfig('user.email', core.getInput('email'));

    try {
        const eventName = core.getInput('event_name');
        if (eventName !== 'pull_request') {
            return;
        }

        const eventJson = core.getInput('event');
        const payload: WebhookPayloadPullRequest = JSON.parse(eventJson);

        let versionBump: string | undefined = undefined;

        if (!(payload.action === 'closed' && payload.pull_request.merged)) {
            return;
        }

        await git.checkout(payload.pull_request.base.ref);

        // Check for `#major`/`#minor`/`#patch` in PR body
        for (const trigger of VERSION_BUMP_TRIGGERS) {
            if (payload.pull_request.body.includes(trigger)) {
                versionBump = trigger.replace('#', '');
                break;
            }
        }

        // TODO: Check for `#major`/`#minor`/`#patch` in merge commit?

        versionBump = versionBump || 'minor';

        childProcess.execSync(`./gradlew -P release-type=${versionBump} bump-version`);

        const tempDir = fs.mkdtempSync('gradle-scripts');
        const tempFile = path.join(tempDir, 'init.gradle');
        fs.writeFileSync(
            tempFile,
            `rootProject {
  task 'dumpVersion' {
    println version
  }
}`
        );
        const newVersion = childProcess.execSync(`./gradlew -I ${tempFile} dumpVersion`).toString();
        fs.rmdirSync(tempDir);

        await git.commit(`Bumped ${versionBump} version to ${newVersion}`);
        await git.push();

        core.setOutput('newVersion', newVersion);
        core.setOutput('versionBump', versionBump);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
