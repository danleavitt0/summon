/**
 * Imports
 */

import middleware, {subscribe, unsubscribe, invalidate, localInvalidate} from './middleware'
import handleActions from '@f/handle-actions'
import createAction from '@f/create-action'
import {fetch} from 'redux-effects-fetch'
import identity from '@f/identity'
import element from 'vdux/element'
import sleep from '@f/sleep'
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
const enqueue = createAction('vdux-summon: enqueue request')
const shiftQueue = createAction('vdux-summon: shift queue')
const success = createAction('vdux-summon: request succeeded')
const error = createAction('vdux-summon: request error')
const shiftInvalidate = createAction('vdux-summon: shift invalidate')

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
          invalid: [],
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

      onUpdate: function * (prev, {props, state, local}) {
        for (let key in state) {
          const desc = state[key]
          const pdesc = prev.state[key] || {}

          if (pdesc.loading && !desc.loading && desc.queue && desc.queue.length) {
            yield local(shiftQueue)({key})
            yield desc.queue[0]
          }
        }

        yield resolve(fn(props), state, local)
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
  [loading]: (state, {key, method, url, clear, params, subscribe}) => ({
    ...state,
    [key]: {
      ...state[key],
      method,
      url,
      subscribe,
      error: null,
      loading: true,
      invalid: [],
      loaded: !clear,
      value: clear ? null : state[key].value,
      params
    }
  }),
  [enqueue]: (state, {key, request}) => ({
    ...state,
    [key]: {
      ...state[key],
      queue: [...(state[key].queue || []), request]
    }
  }),
  [shiftQueue]: (state, {key}) => ({
    ...state,
    [key]: {
      ...state[key],
      queue: state[key].queue.slice(1)
    }
  }),
  [success]: (state, {key, value}) => ({
    ...state,
    [key]: {
      ...state[key],
      loading: false,
      loaded: true,
      invalid: [],
      value
    }
  }),
  [error]: (state, {key, error}) => ({
    ...state,
    [key]: {
      ...state[key],
      loading: false,
      value: null,
      invalid: [],
      error
    }
  }),
  [localInvalidate]: (state, {key, cb}) => {
    const newState = {}
    let changed = false

    for (let name in state) {
      const item = state[name]

      if (shouldInvalidate(item, key)) {
        newState[name] = {...item, invalid: [...(item.invalid || []), cb]}
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
  },
  [shiftInvalidate]: (state, name) => {
    const item = state[name]
    const invalid = (item.invalid || []).slice()

    invalid.shift()

    return {
      ...state,
      [name]: {
        ...item,
        invalid
      }
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
    if (!val) continue

    if (typeof val !== 'function') {
      const descriptor = typeof mapping[key] === 'string'
        ? {url: mapping[key]}
        : mapping[key]
      const {method = 'GET'} = descriptor
      const itemState = state[key] || {}

      if (descriptor.url && (method !== 'GET' || descriptor.url !== itemState.url)) {
        const request = resolveUrl(key, descriptor, itemState, local, rethrow, descriptor.clear)

        resolvingKeys[key] = true

        if (descriptor.serialize && itemState.loading) {
          yield local(enqueue)({key, request})
        } else {
          paused.push(request)
        }
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

    if (!resolvingKeys[key] && itemState.invalid.length) {
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
      subscribe: subscribeKey,
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

    if (state.invalid && state.invalid[0]) {
      state.invalid[0](null, xfVal)
      yield local(shiftInvalidate)(key)
    }

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

    yield local(success)({
      url,
      key,
      value: xfVal
    })

    return xfVal
  } catch (err) {
    if (descriptor.autoretry) {
      yield sleep(1000)
      yield resolveUrl(key, descriptor, state, local, rethrow, clear)
      return
    }

    if (state.invalid && state.invalid[0]) {
      state.invalid[0](err)
      yield local(shiftInvalidate)(key)
    }

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
