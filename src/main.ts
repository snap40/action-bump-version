import * as core from '@actions/core';
import fs from 'fs';
import {WebhookPayloadPullRequest} from '@octokit/webhooks';
import simplegit, {SimpleGit} from 'simple-git/promise';
import semver from 'semver';

const TRIGGERS_TO_RELEASE_TYPES: {[trigger: string]: semver.ReleaseType} = {
    '#major': 'major',
    '#minor': 'minor',
    '#patch': 'patch'
};

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
        if (!(payload.action === 'closed' && payload.pull_request.merged)) {
            return;
        }

        const branchName = payload.pull_request.base.ref;
        await git.checkout(branchName);

        let releaseType: semver.ReleaseType = 'minor';
        // Check for `#major`/`#minor`/`#patch` in PR body
        for (const trigger in TRIGGERS_TO_RELEASE_TYPES) {
            if (payload.pull_request.body.includes(trigger)) {
                releaseType = TRIGGERS_TO_RELEASE_TYPES[trigger];
                break;
            }
        }

        const versionFile = core.getInput('version_file');
        const oldVersion = fs.readFileSync(versionFile).toString();
        const newVersion = semver.inc(oldVersion, releaseType);

        if (!newVersion) {
            throw {
                message: `Could not bump ${releaseType} version ${oldVersion}; returned null`
            };
        }

        fs.writeFileSync(versionFile, newVersion);

        await git.commit(`Bumped ${releaseType} version to ${newVersion}`, [versionFile]);
        await git.push(undefined, branchName);

        core.setOutput('newVersion', newVersion);
        core.setOutput('releaseType', releaseType);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
