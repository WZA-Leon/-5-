'use strict';
/* 纯 JS 图像工具库统一出口 */
module.exports = {
  ...require('./png'),
  ...require('./image'),
  ...require('./color'),
  ...require('./ccl'),
  ...require('./morph'),
  ...require('./draw'),
  ...require('./affine'),
  ...require('./inpaint'),
  ...require('./flow'),
  ...require('./io'),
  ...require('./paths'),
};