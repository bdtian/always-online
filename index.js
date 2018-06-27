var logger = require('./utils/logger')('always-online-app');

logger.info(
  '\n***************************************************',
  '\nrun always-online:',
  '\nnode index.js option, option can be: websocket|api|test|all, default is websocket',
  '\n***************************************************'
);

var arguments = process.argv.splice(2);
if (arguments.length == 0) {
  arguments[0] = 'websocket';
}
var serviceName = arguments[0];
logger.info('start service:', serviceName);

function uncaughtExceptionHandler(err) {
  logger.error(err);
  if(err && err.code == 'ECONNREFUSED') {
    logger.error('service exit');
  } else {
    logger.error('service exit');
    process.exit(1);
  }
}

process.on('uncaughtException', uncaughtExceptionHandler)

if (serviceName == 'api' || serviceName == 'all') {
  require('./api/index');
}

if (serviceName == 'websocket' || serviceName == 'all') {
  require('./websocket/index');
}

if (serviceName == 'test' || serviceName == 'all') {
  require('./test/index');
}