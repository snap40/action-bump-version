import * as core from '@actions/core';
import fs from 'fs';
import {WebhookPayloadPullRequest} from '@octokit/webhooks';
import simplegit, {SimpleGit} from 'simple-git/promise';
import semver from 'semver';

const TRIGGERS_TO_RELEASE_TYPES: {[trigger: string]: semver.ReleaseType} = {
    '##major': 'major',
    '##minor': 'minor',
    '##patch': 'patch'
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
        const versionFile = core.getInput('version_file');

        await git.fetch('origin');

        const branchName = payload.pull_request.head.ref;
        console.log(`Checking out ${branchName}`);
        await git.checkout(branchName);
        const base = payload.pull_request.base;

        const trunkName = `origin/${base.ref}`;
        console.log(`Checking out ${versionFile} on ${trunkName}`);

        try {
            await git.checkout([`${trunkName}`, '--', versionFile]);
        } catch (err) {
            console.warn(
                `Failed to check out ${versionFile} on ${trunkName}, presumably because this is the PR which introduces it. Keeping the version in ${branchName}.`,
                err
            );
        }

        let releaseType: semver.ReleaseType = 'minor';
        // Check for `##major`/`##minor`/`##patch` in PR body
        for (const trigger in TRIGGERS_TO_RELEASE_TYPES) {
            if (payload.pull_request.body.includes(trigger)) {
                releaseType = TRIGGERS_TO_RELEASE_TYPES[trigger];
                break;
            }
        }

        const oldVersion = fs
            .readFileSync(versionFile)
            .toString()
            .trim();
        const newVersion = semver.inc(oldVersion, releaseType)?.trim();

        if (!newVersion) {
            throw {
                message: `Could not bump ${releaseType} version ${oldVersion}; returned null`
            };
        }

        console.log(`Bumping ${releaseType} version from ${oldVersion} (${trunkName}) to ${newVersion}`);

        fs.writeFileSync(versionFile, newVersion);

        const diffSummary = await git.diffSummary(['--', versionFile]);

        if (diffSummary.changed > 0) {
            await git.commit(
                `Bump ${releaseType} version from ${oldVersion} (${trunkName}) to ${newVersion}

## AUTOMATIC VERSION BUMP ##`,
                [versionFile]
            );
            await git.push('origin', branchName);
        }

        core.setOutput('newVersion', newVersion);
        core.setOutput('releaseType', releaseType);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
