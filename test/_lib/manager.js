const { Manager } = require('node-norm');

module.exports = function createManager (config) {
  const connection = require('./config')(config);

  return new Manager({ connections: [connection] });
};
