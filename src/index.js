/**
 * Imports
 */

import middleware, {subscribe, unsubscribe, invalidate} from './middleware'
import handleActions from '@f/handle-actions'
import createAction from '@f/create-action'
import {fetch} from 'redux-effects-fetch'
import identity from '@f/identity'
import element from 'vdux/element'
import map from '@f/map-obj'
import qs from 'qs'

/**
 * Config
 */

let config = {
  baseUrl: ''
}

/**
 * Component url/key map
 */

const keysToComponents = {}
const componentsToKeys = {}

/**
 * Actions
 */

const loading = createAction('vdux-summon: request loading')
const success = createAction('vdux-summon: request succeeded')
const error = createAction('vdux-summon: request error')

/**
 * Summon
 */

function connect (fn) {
  return function (Ui) {
    /**
     * Component
     */

    const Component = {
      initialState ({props, state}) {
        return map((url, name) => ({
          name,
          loading: true,
          error: null,
          value: null
        }), fn(props))
      },

      onCreate ({props, state, local, path}) {
        return resolve(fn(props), state, local, path)
      },

      render ({props, state, children, local, path}) {
        const mapping = fn(props)
        const fns = {}

        for (const key in mapping) {
          if (typeof mapping[key] === 'function') {
            fns[key] = (...args) => resolve(mapping[key](...args), state, local, path)
          }
        }

        return (
          <Ui {...state} {...fns} {...props}>
            {children}
          </Ui>
        )
      },

      reducer: handleActions({
        [loading]: (state, {key, ...rest}) => ({
          ...state,
          [key]: {
            ...state[key],
            ...rest
          }
        }),
        [success]: (state, {key, value}) => ({
          ...state,
          [key]: {
            ...state[key],
            loading: false,
            loaded: true,
            value
          }
        }),
        [error]: (state, {key, error}) => ({
          ...state,
          [key]: {
            ...state[key],
            loading: false,
            error
          }
        })
      }),

      onUpdate (prev, {props, state, local}) {
        return resolve(fn(props), state, local)
      },

      onRemove ({path}) {
        return unsubscribe(path)
      }
    }

    return Component
  }
}

/**
 * Data resolution
 */

function *resolve (mapping, state, local, path) {
  const result = []

  for (const key in mapping) {
    const val = mapping[key]
    if (typeof val !== 'function') {
      const descriptor = typeof mapping[key] === 'string' ? {url: mapping[key]} : mapping[key]
      const {method = 'GET'} = descriptor
      const itemState = state[key] || {}

      if (descriptor.url && (method !== 'GET' || descriptor.url !== itemState.url)) {
        result.push(yield resolveUrl(key, descriptor, local, path))
      } else if (descriptor.params) {
        result.push(yield resolveFragment(key, descriptor, itemState, local, path))
      }
    }
  }

  return result.length === 1
    ? result[0]
    : result
}

function *resolveUrl (key, descriptor, local, path) {
  const {url, method = 'GET',  subscribe: subscribeKey, xf = identity, invalidates, ...fetchParams} = descriptor

  if (!url) throw new Error('vdux-summon: Did you forget to specify a url?')

  try {
    const isGet = /GET/i.test(method)

    if (isGet && subscribeKey !== false) {
      const refresh = function *() {
        yield resolveUrl(key, descriptor, local, path)
      }

      yield subscribe({key: url, path, refresh})

      if (typeof subscribeKey === 'string') {
        yield subscribe({key: subscribeKey, path, refresh})
      } else if (Array.isArray(subscribeKey)) {
        yield subscribeKey.map(key => subscribe({key, path, refresh}))
      }
    }

    yield local(loading)({
      url,
      key,
      value: null,
      loading: true,
      loaded: false
    })

    const {value} = yield fetch(getUrl(url), {
      method,
      ...fetchParams
    })

    const xfVal = xf(value)
    yield local(success)({
      url,
      key,
      value: xfVal
    })

    // Automatically invalidate the URL that a non-get request was
    // sent to, unless `invalidates` is explicitly set to `false`
    if (!isGet && invalidates !== false) {
      yield invalidate(url)
    }

    if (invalidates) {
      yield Array.isArray(invalidates)
        ? invalidates.map(key => invalidate(key))
        : invalidate(invalidates)
    }

    return xfVal
  } catch (err) {
    yield local(error)({
      url,
      key,
      error: err.value || err
    })

    throw err
  }
}

function *resolveFragment (key, descriptor, state, local, path) {
  const {params, xf = identity, clear} = descriptor
  const merge = getMerge(descriptor.merge)
  const {url} = state
  const mergedParams = {...(state.params || {}), ...params}
  const prevValue = clear ? null : state.value

  if (!state.url) throw new Error('vdux-summon: Fragment can only be specified if an existing url has already been set for the collection')

  try {
    yield local(loading)({
      url,
      key,
      value: prevValue,
      loading: true,
      loaded: !clear,
      params: mergedParams
    })

    let {value} = yield fetch(getUrl(url, qs.stringify(mergedParams)))

    value = merge(prevValue, xf(value))

    yield local(success)({url, key, value})
    return value
  } catch (err) {
    yield local(error)({
      url,
      key,
      error: err.value || err
    })

    throw err
  }
}

/**
 * Helpers
 */

function getUrl (url, querystring) {
  const resource = url[0] === '/'
    ? join(config.baseUrl, url)
    : url

  if (!querystring) return resource

  return resource.indexOf('?') !== -1
    ? resource + '&' + querystring
    : resource + '?' + querystring
}

function join (a, b) {
  return a[a.length - 1] === '/' && b[0] === '/'
    ? a + b.slice(1)
    : a + b
}

function getMerge (merge) {
  if (merge === undefined) merge = 'concat'

  if (typeof merge === 'string') {
    switch (merge) {
      case 'replace':
        return mergeReplace
      case 'concat':
        return mergeConcat
    }
  } else {
    return merge
  }
}

function mergeReplace (prev, next) {
  return next
}

function mergeConcat (prev, next) {
  prev = prev || {items: []}

  return {
    ...next,
    items: [...prev.items, ...next.items]
  }
}

function defaults (newConfig) {
  config = {
    ...config,
    ...newConfig
  }
}

connect.defaults = defaults

/**
 * Exports
 */

export default connect
export {
  invalidate,
  middleware
}
