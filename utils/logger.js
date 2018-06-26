const log4js = require('log4js');
const util = require('util');

module.exports = function(filename) {
  log4js.configure({
    appenders: {
      console: {
        type: 'stdout'
      },
      file: {
        type: 'dateFile',
        filename: util.format('logs/%s_', filename),
        pattern: 'yyyy-MM-dd.log',
        alwaysIncludePattern: true,
        maxLogSize: 8 * 1024 * 1024,
        backups: 4
      }
    },
    categories: { default: { appenders: ['console', 'file'], level: 'trace' } }
  });

  return log4js.getLogger();
};
  