/**
 * Imports
 */

import middleware, {subscribe, unsubscribe, invalidate, localInvalidate} from './middleware'
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
 * Actions
 */

const loading = createAction('vdux-summon: request loading')
const success = createAction('vdux-summon: request succeeded')
const error = createAction('vdux-summon: request error')

/**
 * Summon
 */

function connect (fn) {
  return Ui => {
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
        return [
          subscribe(path),
          resolve(fn(props), state, local)
        ]
      },

      render ({props, state, children, local}) {
        const mapping = fn(props)
        const fns = {}

        for (const key in mapping) {
          if (typeof mapping[key] === 'function') {
            fns[key] = (...args) => resolve(mapping[key](...args), state, local, true)
          }
        }

        return (
          <Ui {...normalizeState(state, mapping)} {...fns} {...props}>
            {children}
          </Ui>
        )
      },

      reducer,

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
 * Reducer
 */

const reducer = handleActions({
  [loading]: (state, {key, method, url, clear, params}) => ({
    ...state,
    [key]: {
      ...state[key],
      method,
      url,
      error: null,
      loading: true,
      invalid: false,
      loaded: !clear,
      value: clear ? null : state[key].value,
      params
    }
  }),
  [success]: (state, {key, value}) => ({
    ...state,
    [key]: {
      ...state[key],
      loading: false,
      loaded: true,
      invalid: false,
      value
    }
  }),
  [error]: (state, {key, error}) => ({
    ...state,
    [key]: {
      ...state[key],
      loading: false,
      value: null,
      invalid: false,
      error
    }
  }),
  [localInvalidate]: (state, {key, cb}) => {
    const newState = {}
    let changed = false

    for (let name in state) {
      const item = state[name]

      if (shouldInvalidate(item, key)) {
        newState[name] = {...item, invalid: cb}
        changed = true
      }
    }

    if (!changed) {
      cb()
      return state
    }

    return {
      ...state,
      ...newState
    }
  }
})

function shouldInvalidate (item, key) {
  return item.method === 'GET'
    && (item.url === key
    || item.subscribe === key
    || (Array.isArray(item.subscribe) && item.subscribe.indexOf(key) !== -1))
}

function normalizeState (state, mapping) {
  return map((state, key) => mapping[key] && mappingUrl(mapping[key]) !== state.url
      ? {...state, loading: true}
      : state
    , state)
}

function mappingUrl (mapping) {
  return typeof mapping === 'string'
    ? mapping
    : mapping.url
}

/**
 * Data resolution
 */

function *resolve (mapping, state, local, rethrow) {
  const paused = []
  const resolvingKeys = {}

  for (const key in mapping) {
    const val = mapping[key]
    if (typeof val !== 'function') {
      const descriptor = typeof mapping[key] === 'string'
        ? {url: mapping[key]}
        : mapping[key]
      const {method = 'GET'} = descriptor
      const itemState = state[key] || {}

      if (descriptor.url && (method !== 'GET' || descriptor.url !== itemState.url)) {
        resolvingKeys[key] = true
        paused.push(resolveUrl(key, descriptor, itemState, local, rethrow))
      } else if (descriptor.params) {
        resolvingKeys[key] = true
        paused.push(resolveFragment(key, descriptor, itemState, local, rethrow))
      }
    }
  }

  for (const key in state) {
    const itemState = state[key]
    const descriptor = typeof mapping[key] === 'string'
      ? {url: mapping[key]}
      : mapping[key]

    if (!resolvingKeys[key] && itemState.invalid) {
      paused.push(resolveUrl(key, descriptor, itemState, local, rethrow, false))
    }
  }

  const result = yield paused
  return result.length === 1
    ? result[0]
    : result
}

function *resolveUrl (key, descriptor, state, local, rethrow, clear = true) {
  const {url, method = 'GET',  subscribe: subscribeKey, xf = identity, invalidates, ...fetchParams} = descriptor

  if (!url) throw new Error('vdux-summon: Did you forget to specify a url?')

  try {
    const isGet = /GET/i.test(method)

    yield local(loading)({
      method,
      url,
      key,
      clear,
      params: null
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

    if (state.invalid) state.invalid(null, xfVal)

    // Automatically invalidate the URL that a non-get request was
    // sent to, unless `invalidates` is explicitly set to `false`
    // or the method was 'DELETE'
    if (!isGet && invalidates !== false && method !== 'DELETE') {
      yield invalidate(url)
    }

    if (invalidates) {
      yield Array.isArray(invalidates)
        ? invalidates.map(key => invalidate(key))
        : invalidate(invalidates)
    }

    return xfVal
  } catch (err) {
    if (state.invalid) state.invalid(err)

    yield local(error)({
      url,
      key,
      error: err.value || err
    })

    if (rethrow) {
      throw err
    }
  }
}

function *resolveFragment (key, descriptor, state, local, rethrow) {
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
      clear,
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

    if (rethrow) {
      throw err
    }
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
  middleware,
  reducer
}
