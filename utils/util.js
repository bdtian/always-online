module.exports = {
  genRandString: function(len, charSet) {
    charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    len = len || 24;
    var randomString = '';
    for (var i = 0; i < len; i++) {
     var randomPoz = Math.floor(Math.random() * charSet.length);
     randomString += charSet.substring(randomPoz,randomPoz+1);
    }
    return randomString;
  }
}