/**
 * Imports
 */

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
 * Summon
 */

function connect (fn, Ui) {
  /**
   * Actions
   */

  const loading = createAction('vdux-summon: request loading')
  const success = createAction('vdux-summon: request succeeded')
  const error = createAction('vdux-summon: request error')

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

    onCreate ({props, state, local}) {
      return resolve(fn(props), state, local)
    },

    render ({props, state, children, local}) {
      const mapping = fn(props)
      const fns = {}

      for (const key in mapping) {
        if (typeof mapping[key] === 'function') {
          fns[key] = (...args) => resolve(mapping[key](...args), state, local)
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
    }
  }

  /**
   * Resolve data
   *
   * The meat of this library is here
   */

  function *resolve (mapping, state, local) {
    for (const key in mapping) {
      const val = mapping[key]
      if (typeof val !== 'function') {
        yield resolveDescriptor(key, mapping[key], state[key], local)
      }
    }
  }

  function *resolveDescriptor (key, descriptor, state, local) {
    descriptor = typeof descriptor === 'string' ? {url: descriptor} : descriptor
    const {url = state.url, fragment = '', merge} = descriptor

    if (!url) {
      if (fragment) throw new Error('vdux-summon: Fragment can only be specified if an existing url has already been set for the collection')
      else throw new Error('vdux-summon: Did you forget to specify a url?')
    }

    if (url !== state.url || fragment) {
      try {
        yield local(loading)({url, key, reload: !!fragment})

        let {value} = yield fetch(getUrl(url + fragment))

        if (descriptor.merge || fragment) {
          const merge = typeof descriptor.merge === 'function' ? descriptor.merge : defaultMerge
          value = merge(state.value, value)
        }

        yield local(success)({url, key, value})
      } catch (err) {
        console.log("err", err.stack)
        yield local(error)({
          url,
          key,
          error: err.value || err
        })
      }
    }
  }

  return Component
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
