/*jshint node: true*/

'use strict';

var path = require('path');

module.exports = function (grunt) {

    require('runonymous-grunt')(grunt);

    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-git-describe');
    grunt.loadNpmTasks('grunt-git');
    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('brix-release', 'Release a new build', function (type) {
        var releaseId = 'release' + new Date().getTime(),
            releasePath = releaseId + '/',
            releaseVersion,
            releaseBranch,
            releaseBuildCwd,

            revision,

            taskNext,
            taskRun,
            tasks,

            cfg = {},
            opts;

        // Init task config
        cfg.files = grunt.config.get('release').files || {};

        // Init task options
        opts = this.options({
            gitflow: {
                feature: 'feature',
                develop: 'develop',
                release: 'release',
                hotfix: 'hotfix',
                master: 'master'
            }
        });

        // Stop on errors
        if (['major', 'minor', 'patch', 'prerelease'].indexOf(type) === -1) {
            return grunt.log.error('Unsupported release type:', type), false;
        }

        if (!opts.buildTask) {
            return grunt.log.error('Build task is not defined'), false;
        }

        if (!cfg.files.dest) {
            return grunt.log.error('Build destination is not defined'), false;
        }

        // Set the releas build cwd
        releaseBuildCwd = releasePath + cfg.files.dest + '/';

        // Task resies helper
        taskNext = function taskNext() {
            var task = tasks.shift();

            if (task) {
                task(taskNext);
            }
        };

        // Define config and run task
        taskRun = function taskRun(taskName, conf, next) {
            var set;

            if (conf) {
                // Define task config
                set = {};
                set[releaseId] = conf;

                // Set task config
                grunt.config.set(taskName, set);

                taskName += ':' + releaseId;
            }

            // Run the task
            grunt.task.run(taskName, next);
        };

        tasks = [

            // Checkout a release branch
            function (next) {
                taskRun('gitcheckout', {
                    options: {
                        cwd: '.',
                        branch: opts.gitflow.develop
                    }
                }, next);
            },

            function (next) {
                taskRun('bump:' + type, null, next);
            },

            // Read the new version
            function (next) {
                releaseVersion = grunt.file.readJSON('package.json').version;

                releaseBranch = opts.gitflow.release + '/' + releaseVersion;

                next();
            },

            // Run the defined build task
            function (next) {
                taskRun(opts.buildTask, null, next);
            },

            // Copy the build destination
            function (next) {
                taskRun('copy', {
                    files: [{
                        expand: true,
                        dot: true,
                        src: [
                            cfg.files.dest + '/**/*'
                        ],
                        dest: releasePath
                    }]
                }, next);
            },

            // Copy the repository
            function (next) {
                taskRun('copy', {
                    files: [{
                        expand: true,
                        dot: true,
                        src: [
                            '.git/**/*',
                            '.gitignore'
                        ],
                        dest: releaseBuildCwd
                    }]
                }, next);
            },

            // Git info
            function (next) {
                grunt.event.once('git-describe', function (rev) {
                    grunt.log.writeln("Git rev tag: " + rev.tag);
                    grunt.log.writeln("Git rev since: " + rev.since);
                    grunt.log.writeln("Git rev object: " + rev.object); // The 6 character commit SHA by itself
                    grunt.log.writeln("Git rev dirty: " + rev.dirty);

                    revision = rev;
                });

                taskRun('git-describe', {}, next);
            },

            // Checkout a release branch
            function (next) {
                taskRun('gitcheckout', {
                    options: {
                        cwd: releaseBuildCwd,
                        branch: releaseBranch,
                        create: true
                    }
                }, next);
            },

            // Stage all files
            function (next) {
                taskRun('exec', {
                    cwd: releaseBuildCwd,
                    command: 'git add -A'
                }, next);
            },

            // Commit the build
            function (next) {
                taskRun('gitcommit', {
                    options: {
                        cwd: releaseBuildCwd,
                        message: 'Build release v' + releaseVersion,
                        noVerify: false,
                        noStatus: false
                    }
                }, next);
            },

            // Checkout a the master branch
            function (next) {
                taskRun('gitcheckout', {
                    options: {
                        cwd: releaseBuildCwd,
                        branch: opts.gitflow.master,
                        create: false
                    }
                }, next);
            },

            // Merge release into master branch
            function (next) {
                taskRun('gitmerge', {
                    options: {
                        cwd: releaseBuildCwd,
                        branch: releaseBranch,
                        message: 'Merge from ' + releaseBranch
                    }
                }, next);
            },

            // Tag the release
            function (next) {
                taskRun('gittag', {
                    options: {
                        cwd: releaseBuildCwd,
                        message: 'Set release tag ' + releaseVersion,
                        tag: releaseVersion
                    }
                }, next);
            },

            // Checkout a previous revision
            function (next) {
                taskRun('gitcheckout', {
                    options: {
                        cwd: releaseBuildCwd,
                        branch: opts.gitflow.develop
                    }
                }, next);
            },

            // Delete the release branch
            function (next) {
                taskRun('exec', {
                    cwd: releaseBuildCwd,
                    command: 'git branch -D ' + releaseBranch
                }, next);
            },

            // Copy the repository
            function (next) {
                taskRun('clean', {
                    expand: true,
                    dot: true,
                    files: [{
                        src: [
                            '.git/**/*'
                        ]
                    }]
                }, next);
            },

            // Copy the repository
            function (next) {
                taskRun('copy', {
                    files: [{
                        cwd: releaseBuildCwd,
                        expand: true,
                        dot: true,
                        src: [
                            '.git/**/*'
                        ],
                        dest: '.'
                    }]
                }, next);
            }
        ];

        // Start task series
        grunt.task.run(taskNext);
    });

};
