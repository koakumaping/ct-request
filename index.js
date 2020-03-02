import axios from 'axios'
import {
  decode64,
  hasOwn,
  randomString,
  isEmpty,
  isObject,
  isFunction,
} from 'ct-util'
import cookie from 'js-cookie'
import store from 'store'

// 当前系统名称
let packageInfo = {
  name: '',
  version: '',
}

// 建立websocket
const wss = 'ws://192.168.7.233:9999'
let ws = ''

const connectWebsocket = (callback = () => {}) => {
  ws = new window.WebSocket(wss)
  ws.onopen = () => {
    console.log('websocket connect:', wss)
    callback()
  }

  ws.onmessage = (response) => {
    console.log('websocket get from server:', response.data)
  }

  ws.onclose = () => {
    console.log('ws close')
    ws = ''
  }
}

const setPackageInfo = (payload = {}) => {
  packageInfo = payload
}

const send = (message) => {
  const handleSend = () => {
    ws.send(message)
  }
  if (ws.readyState !== 1) {
    try {
      ws.close()
    } catch (error) {
      (() => {})()
    }
    if (!ws) connectWebsocket()
    window.setTimeout(() => {
      handleSend()
    }, 250)
  } else {
    handleSend()
  }
}

const r = () => {
  let routerName = ''
  let routerNameCN = ''
  let headers = {}
  let apiItem = {}
  let sendConfig = {}
  let receiveData = {}
  const startTime = new Date()

  const logToServer = (type = 'success') => {
    const { href, host, pathname, search, hash } = window.location
    let data = ''
    try {
      data = JSON.parse(sendConfig.data)
    } catch (error) {
      data = sendConfig.data
    }

    const sendData = {
      ispc: 1,
      key: randomString(24, true, false),
      routerName,
      routerNameCN,
      href,
      host,
      pathname,
      search,
      hash,
      headers,
      action: 'api',
      type,
      userId: store.get('id'),
      user: store.get('name'),
      method: sendConfig.method.toUpperCase(),
      url: sendConfig.url,
      data,
      params: sendConfig.params,
      response: receiveData,
      take: new Date() - startTime,
    }

    if (sendData.routerName === 'login') data.psd = '保密'
    send(JSON.stringify(sendData))
  }

  const instance = axios.create()
  // Alter defaults after instance has been created
  instance.defaults.headers.common['Access-Control-Allow-Origin'] = '*'

  // Override timeout default for the library
  instance.defaults.timeout = 100000

  instance.interceptors.request.use((config) => {
    // Do something before request is sent
    // 读取真正的url地址
    routerName = config.url
    apiItem = window.api.get(routerName)
    routerNameCN = apiItem.name
    config.url = isEmpty(apiItem) ? config.url : apiItem.url
    // 设置Access-Token
    config.headers['Access-Token'] = store.get('masterKey') || cookie.get('masterKey')
    // 设置唯一标识
    config.headers.clientrandid = store.get('clientrandid') || ''
    config.headers.charset = 'utf-8'
    headers = config.headers.common
    // 设置appkey
    const params = {
      appkey: window.sessionStorage.getItem('token') || '',
      t: +new Date(),
      v: packageInfo.version,
    }
    const _params = config.params ? config.params : {}
    config.params = Object.assign(_params, params)
    console.log('请求:', apiItem.name || config.url, config.method, config.params)
    sendConfig = config
    return config
  }, (error) => {
    // Do something with request error
    receiveData = error
    logToServer('error')
    return Promise.reject(error)
  })

  instance.interceptors.response.use((response) => {
    // Do something with response data
    const results = response.data
    results.errcode = Number(results.errcode)
    if (hasOwn(results, 'v')) {
      const v = results.v
      const serverVersion = v[packageInfo.name.replace(/ct-/g, '')]
      store.set('serverVersion', v)
      if (isFunction(window.updateVersion) && packageInfo.version !== serverVersion) window.updateVersion({
        name: packageInfo.name,
        version: packageInfo.version,
        serverVersion,
      })
    }
    if (hasOwn(results, 'data')) {
      try {
        results.data = window.unescape(decode64(results.data))
        results.data = JSON.parse(results.data)
      } catch (e) {
        // 防止eslint报错
        console.log(e)
        console.log(results)
      }
    }

    receiveData = results
    logToServer()

    const errcode = results.errcode

    if (errcode === 0) {
      console.log('返回:', apiItem.name, results.data)
      if (results.err) {
        window.notice.warn({
          title: '提示',
          content: results.err,
        })
        if (!isObject(results.data)) {
          results.data = {
            err: results.err,
          }
        } else {
          results.data.err = results.err
        }
      }
      return Promise.resolve(results.data)
    } else if ([5, 7, 8].indexOf(errcode) > -1) {
      // 6 表示需要短信验证，这边排除掉先
      // show('请重新登录')
      let reason = '登录超时'
      if (errcode !== 5) {
        reason = `原因：${results.err}`
      }
      console.log(reason)
      window.location.replace(`/#/login?from=${window.location.hash}`)
    } else {
      console.log(results)
      if (errcode === 1 && results.err === '没有请求该接口权限') {
        window.location.replace('/#/401')
      } else if (errcode !== 9 && errcode !== 10) {
        // window.$n.error(results.err, 0)
        window.notice.error({
          title: '错误信息',
          content: results.err,
          closeTime: 10 * 1000,
        })
      }
    }
    return Promise.reject(results)
  }, (error) => {
    // Do something with response error
    receiveData = error
    logToServer('error')
    window.notice.error({
      title: '错误信息',
      content: error,
    })
    return Promise.reject(error)
  })

  return instance
}

export {
  connectWebsocket,
  send,
  r,
  setPackageInfo,
}