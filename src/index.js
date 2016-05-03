/**
 * Imports
 */

import middleware, {subscribe, unsubscribe, invalidate} from './middleware'
import handleActions from '@f/handle-actions'
import createAction from '@f/create-action'
import {fetch} from 'redux-effects-fetch'
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
          loading: true
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

      if (descriptor.url && descriptor.url !== state[key].url) yield resolveUrl(key, descriptor, local, path)
      else if (descriptor.fragment) yield resolveFragment(key, descriptor, state[key], local, path)
    }
  }
}

function *resolveUrl (key, descriptor, local, path) {
  const {url, invalidate} = descriptor

  if (!url) throw new Error('vdux-summon: Did you forget to specify a url?')

  try {
    if (invalidate !== false) {
      const refresh = function *() {
        yield resolveUrl(key, descriptor, local, path)
      }

      yield subscribe({key: url, path, refresh})

      if (typeof invalidate === 'string') {
        yield subscribe({key: invalidate, path, refresh})
      } else if (Array.isArray(invalidate)) {
        yield invalidate.map(key => subscribe({key, path, refresh}))
      }
    }

    yield local(loading)({url, key, reload: false})

    const {value} = yield fetch(getUrl(url))

    yield local(success)({url, key, value})
  } catch (err) {
    yield local(error)({
      url,
      key,
      error: err.value || err
    })
  }
}

function *resolveFragment (key, descriptor, state, local, path) {
  const {fragment, merge = defaultMerge} = descriptor
  if (!state.url) throw new Error('vdux-summon: Fragment can only be specified if an existing url has already been set for the collection')

  try {
    yield local(loading)({url, key, reload: true})

    let {value} = yield fetch(getUrl(url + fragment))

    value = merge(state.value, value)

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
    ? config.baseUrl + url
    : url
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
