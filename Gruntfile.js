module.exports = function(grunt) {
  // Load grunt tasks automatically
  require('load-grunt-tasks')(grunt);

  // Time how long tasks take. Can help when optimizing build times
  require('time-grunt')(grunt);

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    // Directories
    conf: {
      app: 'app',
      dist: 'dist',
      bower: 'app/bower_components',
      linksUrl: 'http://hatrafficinfo.dft.gov.uk/feeds/datex/England/PredefinedLocationLinks/content.xml',
    },

    useminPrepare: {
      html: '<%= conf.app %>/index.html',
      options: {
        dest: '<%= conf.dist %>',
        flow: {
          html: {
            steps: {
              js: [ 'concat' ],
              css: [ 'cssmin' ],
            },
            post: {},
          },
        },
      },
    },

    usemin: {
      html: ['<%= conf.dist %>/*.html'],
      css: ['<%= conf.dist %>/css/*.css'],
      options: {
        assetDirs: ['<%= conf.dist %>'],
      },
    },

    copy: {
      dist: {
        files: [{
          expand: true,
          cwd: '<%= conf.app %>',
          dest: '<%= conf.dist %>',
          src: ['*.html', '*.{gif,png,jpg}', '*.json', 'js/*', 'css/*', ],
        }, {
          // For leaflet
          expand: true,
          cwd: '<%= conf.bower %>/leaflet/dist',
          dest: '<%= conf.dist %>/css',
          src: ['images/*',]
        }],
      },
    },

    clean: {
      dist: {
        files: [{
          dot: true,
          src: ['.tmp', '<%= conf.dist %>/*', '<%= conf.dist %>/.git' ],
        }],
      },
    },
  });

  grunt.registerTask('build', [
      'clean:dist',
      'copy:dist',
      'useminPrepare',
      'concat:generated',
      // 'uglify:generated',
      'cssmin:generated',
      'usemin',
  ]);

  grunt.registerTask('default', ['build']);
}
