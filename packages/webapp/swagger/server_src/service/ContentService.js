const SwaggerImp = require("../../server_imp/content_service").SwaggerImp

'use strict';


/**
 * get content index.html
 * 
 *
 * no response value expected for this operation
 **/
exports.getContent = function() {
  return new Promise(function(resolve, reject) {
    return SwaggerImp.getContent(resolve);
  });
}

