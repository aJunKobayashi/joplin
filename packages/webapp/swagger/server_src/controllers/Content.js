'use strict';

var utils = require('../utils/writer.js');
var Content = require('../service/ContentService');

module.exports.getContent = function getContent (req, res, next) {
  Content.getContent()
    .then(function (response) {
      utils.writeJson(res, response);
    })
    .catch(function (response) {
      utils.writeJson(res, response);
    });
};
