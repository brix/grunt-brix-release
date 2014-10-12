/*jshint node: true*/

'use strict';

var path = require('path'), loadNpmTask;

loadNpmTask = function loadNpmTask(npmTask) {
    require(npmTask + '/tasks/' + npmTask.replace(/^grunt-(contrib-)?/, ''))(loadNpmTask._grunt);
};
loadNpmTask.init = function init(grunt) {
    loadNpmTask._grunt = grunt;
};

module.exports = function (grunt) {
    loadNpmTask.init(grunt);

    // Load tasks from sub path, because main is not defined
    loadNpmTask('grunt-git');
    loadNpmTask('grunt-exec');
    loadNpmTask('grunt-bump');
    loadNpmTask('grunt-contrib-copy');
    loadNpmTask('grunt-contrib-clean');
    loadNpmTask('grunt-git-describe');

    // Load anonymous tasks hook
    require('runonymous-grunt')(grunt);

    grunt.registerTask('brix-release', 'Release a new build', function (type) {
        var releaseId = 'release' + new Date().getTime(),
            releasePath = releaseId + '/',
            releaseVersion,
            releaseBranch,
            releaseBuildCwd,

            revision,

            taskNext,
            taskRun,
            taskRunMulti,
            tasks,

            opts;

        // Init task options
        opts = this.options({
            gitflow: {
                feature: 'feature',
                develop: 'develop',
                release: 'release',
                hotfix: 'hotfix',
                master: 'master'
            },
            build: {},
            bump: {
                files: ['package.json']
            }
        });

        // Stop on errors
        if (['major', 'minor', 'patch', 'prerelease'].indexOf(type) === -1) {
            return grunt.log.error('Unsupported release type:', type), false;
        }

        if (!opts.bump ||!opts.bump.files.length) {
            return grunt.log.error('Missing definiton of files to bump version.'), false;
        }

        if (!opts.build || !opts.build.task) {
            return grunt.log.error('Build task is not defined'), false;
        }

        if (!opts.build || !opts.build.dest) {
            return grunt.log.error('Build destination is not defined'), false;
        }

        // Set the releas build cwd
        releaseBuildCwd = releasePath + opts.build.dest + '/';

        // Task resies helper
        taskNext = function taskNext() {
            var task = tasks.shift();

            if (task) {
                task(taskNext);
            }
        };

        // Define config and run task
        taskRun = function taskRun(taskName, conf, next) {
            if (conf) {
                // Set task config
                grunt.config.set(taskName.split(':')[0], conf);
            }

            // Run the task
            grunt.task.run(taskName, next);
        };

        taskRunMulti = function taskRunMulti(taskName, conf, next) {
            var set;

            if (conf) {
                // Define task config
                set = {};
                set[releaseId] = conf;

                taskName += ':' + releaseId;
            }

            taskRun(taskName, set, next);
        };


        // The task list series
        //
        //
        tasks = [

            // Git info
            function (next) {
                grunt.event.once('git-describe', function (rev) {
                    // grunt.log.writeln("Git rev tag: " + rev.tag);
                    // grunt.log.writeln("Git rev since: " + rev.since);
                    // grunt.log.writeln("Git rev object: " + rev.object); // The 6 character commit SHA by itself
                    // grunt.log.writeln("Git rev dirty: " + rev.dirty);
                    revision = rev;

                });

                taskRunMulti('git-describe', {}, function () {
                    if (revision.dirty) {
                        return grunt.fail.fatal('Please do not release dirty versions! Commit your changes before release.');
                    };

                    next();
                });
            },

            // Bump the version
            function (next) {
                taskRun('bump:' + type, {
                    options: {
                        createTag: false,
                        commit: true,
                        commitFiles: opts.bump.files,
                        commitMessage: 'Bump v%VERSION%',
                        push: false,
                        gitDescribeOptions: '--tags --always --abbrev=1 --dirty=-d',
                        globalReplace: false
                    }
                }, next);
            },

            // Git info
            function (next) {
                grunt.event.once('git-describe', function (rev) {
                    revision = rev;
                });

                taskRunMulti('git-describe', {}, next);
            },

            // Git info extended
            function (next) {
                // Set release variables
                releaseVersion = grunt.file.readJSON('package.json').version;
                releaseBranch = opts.gitflow.release + '/' + releaseVersion;

                taskRunMulti('exec', {
                    command: 'git describe --all',
                    callback: function (err, all) {
                        if (err) {
                            return grunt.fail.fatal(err);
                        }

                        revision.branch = all
                            .replace(/^heads\//, '')
                            .replace(/^\s/, '')
                            .replace(/\s$/, '');
                    }
                }, next);
            },

            // Run the defined build task
            function (next) {
                taskRunMulti(opts.build.task, null, next);
            },

            // Copy the repository to build destination
            function (next) {
                taskRunMulti('copy', {
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

            // Checkout a release branch
            function (next) {
                taskRunMulti('exec', {
                    cwd: releaseBuildCwd,
                    command: 'git checkout -B ' + releaseBranch
                }, next);
            },

            // Copy the build destination
            function (next) {
                taskRunMulti('copy', {
                    files: [{
                        expand: true,
                        dot: true,
                        src: [
                            opts.build.dest + '/**/*'
                        ],
                        dest: releasePath
                    }]
                }, next);
            },

            // Stage all files
            function (next) {
                taskRunMulti('exec', {
                    cwd: releaseBuildCwd,
                    command: 'git add -A'
                }, next);
            },

            // Commit the build
            function (next) {
                taskRunMulti('gitcommit', {
                    options: {
                        cwd: releaseBuildCwd,
                        verbose: true,
                        message: 'Build release v' + releaseVersion,
                        noVerify: false,
                        noStatus: false
                    }
                }, next);
            },

            // Clean the old repository
            function (next) {
                taskRunMulti('clean', {
                    expand: true,
                    dot: true,
                    files: [{
                        src: [
                            '.git/**/*'
                        ]
                    }]
                }, next);
            },

            // Copy the repository from release
            function (next) {
                taskRunMulti('copy', {
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
            },

            // Clean release temp directory
            function (next) {
                taskRunMulti('clean', {
                    expand: true,
                    dot: true,
                    files: [{
                        src: [
                            releasePath
                        ]
                    }]
                }, next);
            },

            // Checkout a the master branch
            function (next) {
                taskRunMulti('exec', {
                    command: 'git checkout -f ' + opts.gitflow.master
                }, next);
            },

            // Merge release into master branch
            function (next) {
                taskRunMulti('exec', {
                    command: 'git merge -s ours -m "Merge from ' + releaseBranch + '" ' + releaseBranch
                }, next);
            },

            // Clean up after merge
            function (next) {
                taskRunMulti('exec', {
                    command: 'git clean -d -f -f'
                }, next);
            },

            // Tag the release
            function (next) {
                taskRunMulti('gittag', {
                    options: {
                        verbose: true,
                        message: 'Set release tag ' + releaseVersion,
                        tag: releaseVersion
                    }
                }, next);
            },

            // Checkout a previous revision
            function (next) {
                taskRunMulti('exec', {
                    command: 'git checkout -f ' + revision.branch
                }, next);
            },

            // Delete the release branch
            function (next) {
                taskRunMulti('exec', {
                    command: 'git branch -D ' + releaseBranch
                }, next);
            }
        ];

        // Start task series
        grunt.task.run(taskNext);
    });

};
