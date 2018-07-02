var codeMap = {
};

codeMap.ok = {code: 0, msg: 'success'};
codeMap.permission = {code: 1, msg: 'require permission'};
codeMap.userExists = {code: 2, msg: 'user exists, please use refresh token api'};
codeMap.operationFailed = {code: 3, msg: 'operation failed'};
codeMap.serverError = {code :4, msg:'server errors'};
codeMap.paramError = {code:5, msg: 'param error'};
codeMap.userNotExists = {code:6, msg: 'user not exists'};
codeMap.roomNotExists = {code:7, msg: 'room not exists'};

module.exports = codeMap;

module.exports.makeResponse = function(status, data) {
  return {
    meta: {
      status: status.code,
      msg: status.msg || ''
    },
    data: data || {}
  }
}