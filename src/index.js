const url = require('url');
const request = require('request-promise');
const _ = require('lodash');
const path = require('path');
const revalidator = require('revalidator');
const mm = require('micromatch');
const ora = require('ora');
const chalk = require('chalk');

const Qiniu = require('./qiniu');
const { combineFiles, mapLimit } = require('./utils');
const Reporter = require('./reporter');

const LOG_FILENAME = '__qiniu__webpack__plugin__files.json';
const CONFIG_FILENAME = '.qiniu_webpack';
const PLUGIN_NAME = 'QiniuWebpackPlugin';

/**
 * options: {
 *    accessKey: string, @required
 *    secretKey: string, @required
 *    bucket: string, @required
 *    bucketDomain: string, @required
 *    matchFiles: [],
 *    uploadPath: string,
 *    batch: number
 * }
 */
class QiniuPlugin {
  constructor(options = { }) {    
    const defaultOptions = {
      uploadPath: 'webpack_assets', // default uploadPath
      batch: 10
    };
    const fileOptions = this.getFileOptions();
    this.options = Object.assign(defaultOptions, options, fileOptions);

    this.validateOptions(this.options);

    let { uploadPath } = this.options;

    if (uploadPath[0] === '/') {
      this.options.uploadPath = uploadPath.slice(1, uploadPath.length);
    }

    const { accessKey, secretKey, bucket, bucketDomain } = this.options;
    this.publicPath = url.resolve(bucketDomain, uploadPath);  // domain + uploadPath
    this.qiniu = new Qiniu({
      accessKey,
      secretKey,
      bucket,
      domain: bucketDomain
    })
  }

  validateOptions(options) {
    let validate = revalidator.validate(options, {
      properties: {
        accessKey: {
          type: 'string',
          required: true
        },
        secretKey: {
          type: 'string',
          required: true
        },
        bucket: {
          type: 'string',
          required: true,
          minLength: 4,
          maxLength: 63
        },
        bucketDomain: {
          type: 'string',
          required: true,
          format: 'url'
        },
        uploadPath: {
          type: 'string'
        },
        matchFiles: {
          type: 'array'
        }
      }
    });

    if (!validate.valid) {
      const { errors } = validate; 
      console.log('[QiniuWebpackPlugin] options validate fail');
      for(let i = 0, len = errors.length; i < len; i++) {
        const error = errors[i];
        console.log(error.property, error.message);
      }
      process.exit();
    }
  }

  apply (compiler) {
    const beforeRunCallback = (compiler, callback) => {
      // TODO: 检查 output.filename 是否有 hash 输出
      compiler.options.output.publicPath = this.publicPath;
      callback();
    }
    
    const afterEmitCallback = async (compilation, callback) => {
      const fileNames = Object.keys(compilation.assets);
      console.log('\n');
      console.log(chalk.bold.green('==== Qiniu Webpack Plugin ==== \n'));
      const reporter = new Reporter('\n');

      /**
       * 对于一些文件名没带 hash 的，怎么处理？？
       * 将每个文件生成一遍 md5，存起来，下次上传时，再校验一遍？？
       */
      // 处理文件过滤
      const releaseFiles = this.matchFiles(fileNames);

      reporter.text = '📦   正在获取历史数据';
      
      // 获取文件日志
      const {
        uploadTime,
        prev: prevFiles = [],
        current: currentFiles = []
      } = await this.getLogFile();
      reporter.log = '📦   获取历史数据';
      
      // 合并去重，提取最终要上传和删除的文件
      const { uploadFiles, deleteFiles } = combineFiles(prevFiles, currentFiles, releaseFiles);
      
      reporter.log = `🍔   将上传 ${uploadFiles.length} 个文件`;
      
      const uploadFileTasks = uploadFiles.map((filename, index) => {
        const file = compilation.assets[filename];

        return async () => {
          const key = path.join(this.options.uploadPath, filename);

          reporter.text = `🚀  正在上传第${index}个文件: ${key}`;
          
          return await this.qiniu.putFile(key, file.existsAt);
        }
      });
      
      await mapLimit(uploadFileTasks, this.options.batch,
        (task, next) => {
          (async () => {
            try {
              const res = await task();
              next(null, res);
            } catch(err) {
              next(err);
            }
          })();
        }
      );

      reporter.log = '❤️   上传完毕';

      // 当有文件要上传才去删除之前版本的文件，且写入日志
      if (uploadFiles.length > 0) {

        if (deleteFiles.length > 0) {
          reporter.log = `👋🏼   将删除 ${deleteFiles.length} 个文件`;
          reporter.text = `🤓   正在批量删除...`;
          await this.deleteOldFiles(deleteFiles);
          reporter.log = `💙   删除完毕`;  
        }

        reporter.text = `📝   正在写入日志...`;
        await this.writeLogFile(currentFiles, releaseFiles);
        reporter.log = `📝   日志记录完毕`
      }

      reporter.succeed('🎉 \n');
      console.log(chalk.bold.green('==== Qiniu Webpack Plugin ==== \n'));

      callback();
    }
    
    if (compiler.hooks) {
      compiler.hooks.beforeRun.tapAsync(PLUGIN_NAME, beforeRunCallback);
      compiler.hooks.afterEmit.tapAsync(PLUGIN_NAME, afterEmitCallback);
    } else {
      compiler.plugin('before-run', beforeRunCallback);
      compiler.plugin('after-emit', afterEmitCallback);
    }

  }

  matchFiles(fileNames) {
    const { matchFiles = [] } = this.options;

    matchFiles.unshift('*'); // all files

    return mm(fileNames, matchFiles, { matchBase: true });
  }
  
  getFileOptions() {
    try {
      return require(path.resolve(CONFIG_FILENAME));
    } catch(e) {
      return null;
    }
  }
  
  /**
   * 删除旧的文件
   * @param {Array<string>} deleteFiles 待删除文件列表
   */
  async deleteOldFiles(deleteFiles) {
    if (deleteFiles.length > 0) {
      console.log('deleteFiles', deleteFiles);
      const keys = deleteFiles.map((filename, index) => path.join(this.options.uploadPath, filename));
      await this.qiniu.batchDelete(keys);
    }
  }

  /**
   * 记录文件列表
   * @param {Array<string>} currentFiles 当前线上的文件列表
   * @param {Array<string>} releaseFiles 等待发布的文件列表
   */
  async writeLogFile(currentFiles, releaseFiles) {
    let json = JSON.stringify({
      prev: currentFiles,
      current: releaseFiles,
      uploadTime: new Date()
    });
    const key = path.join(this.options.uploadPath, LOG_FILENAME);
    return await this.qiniu.put(key, json);
  }

  /**
   * 获取文件列表
   */
  async getLogFile() {
    let remotePath = path.join(this.options.uploadPath, LOG_FILENAME);
    let logDownloadUrl = this.qiniu.getPublicDownloadUrl(remotePath);

    let randomParams = '?r=' + +new Date();
    
    return request({
      uri: logDownloadUrl + randomParams,
      json: true
    })
    .catch(err => ({ prev: [], current: [], uploadTime: '' }))
  }

}

module.exports = QiniuPlugin;

