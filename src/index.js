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

function connect (fn, Ui) {
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
      [loading]: (state, {key, url, reload}) => ({
        ...state,
        [key]: {
          ...state[key],
          url,
          loaded: reload,
          loading: true,
          reload
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

/**
 * Data resolution
 */

function *resolve (mapping, state, local, path) {
  for (const key in mapping) {
    const val = mapping[key]
    if (typeof val !== 'function') {
      const descriptor = typeof mapping[key] === 'string' ? {url: mapping[key]} : mapping[key]
      const {method = 'GET'} = descriptor
      const itemState = state[key] || {}

      if (descriptor.url && (method !== 'GET' || descriptor.url !== itemState.url)) {
        yield resolveUrl(key, descriptor, local, path)
      } else if (descriptor.fragment) {
        yield resolveFragment(key, descriptor, itemState, local, path)
      }
    }
  }
}

function *resolveUrl (key, descriptor, local, path, reload = false) {
  const {url, method = 'GET',  subscribe: subscribeKey, xf = identity, invalidates, ...fetchParams} = descriptor

  if (!url) throw new Error('vdux-summon: Did you forget to specify a url?')

  try {
    const isGet = /GET/i.test(method)

    if (isGet && subscribeKey !== false) {
      const refresh = function *() {
        yield resolveUrl(key, descriptor, local, path, true)
      }

      yield subscribe({key: url, path, refresh})

      if (typeof subscribeKey === 'string') {
        yield subscribe({key: subscribeKey, path, refresh})
      } else if (Array.isArray(subscribeKey)) {
        yield subscribeKey.map(key => subscribe({key, path, refresh}))
      }
    }

    yield local(loading)({url, key, reload})

    const {value} = yield fetch(getUrl(url), {
      method,
      ...fetchParams
    })

    yield local(success)({
      url,
      key,
      value: xf(value)
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
  } catch (err) {
    yield local(error)({
      url,
      key,
      error: err.value || err
    })
  }
}

function *resolveFragment (key, descriptor, state, local, path) {
  const {fragment, merge = defaultMerge, xf = identity} = descriptor
  if (!state.url) throw new Error('vdux-summon: Fragment can only be specified if an existing url has already been set for the collection')

  try {
    yield local(loading)({url, key, reload: true})

    let {value} = yield fetch(getUrl(url + fragment))

    value = merge(state.value, xf(value))

    yield local(success)({url, key, value})
  } catch (err) {
    yield local(error)({
      url,
      key,
      error: err.value || err
    })
  }
}

/**
 * Helpers
 */

function getUrl (url) {
  return url[0] === '/'
    ? join(config.baseUrl, url)
    : url
}

function join (a, b) {
  return a[a.length - 1] === '/' && b[0] === '/'
    ? a + b.slice(1)
    : a + b
}

function defaultMerge (prev = {items: []}, next) {
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
