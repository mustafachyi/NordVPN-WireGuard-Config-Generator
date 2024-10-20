const generateHTML = require('../utils/generateHTML');

const htmlHandler = async (request, reply) => {
  reply.type('text/html').send(generateHTML());
};

module.exports = htmlHandler;