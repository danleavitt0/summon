/**
 * Imports
 */

import middleware, {subscribe, unsubscribe, invalidate, localInvalidate} from './middleware'
import fetchMw, {fetch, fetchEncodeJSON} from 'redux-effects-fetch'
import {query, bearer} from 'redux-effects-credentials'
import {component, element} from 'vdux'
import identity from '@f/identity'
import {compose} from 'redux'
import sleep from '@f/sleep'
import map from '@f/map-obj'
import qs from 'qs'

/**
 * Config
 */

let config = {
  baseUrl: '',
  credentials: [],

  transformRequest (req) {
    return req
  },

  transformResponse (res) {
    return res
  },

  transformError (err) {
    return err
  }
}

let credentialMiddleware = []

connect.configure = function (newConfig) {
  config = {
    ...config,
    ...newConfig,
    credentials: [].concat(newConfig.credentials).filter(Boolean)
  }

  credentialMiddleware = config.credentials.map(({type, name, token, pattern}) => {
    switch (type) {
      case 'bearer':
        return bearer(pattern, token)
      case 'query':
        return query(pattern, name, token)
      default:
        throw new Error('vdux-summon: unsupported credential type')
    }
  })
}

/**
 * Summon
 */

function connect (fn) {
  return Ui => {
    const Component = component({
      initialState ({props, state}) {
        return map((url, name) => ({
          name,
          loading: true,
          invalid: [],
          hasLoaded: false,
          loaded: false,
          error: null,
          value: null
        }), fn(props))
      },

      onCreate ({props, state, actions, path}) {
        return [
          subscribe({path, reducer: Component.reducer}),
          actions.resolve(fn(props), state)
        ]
      },

      render ({props, state, children, actions}) {
        const mapping = fn(props)
        const fns = {}

        for (const key in mapping) {
          if (typeof mapping[key] === 'function') {
            fns[key] = actions.runFunction(key)
          }
        }

        return (
          <Ui {...normalizeState(state, mapping)} {...fns} {...props} summonInvalidate={actions.invalidate}>
            {children}
          </Ui>
        )
      },

      middleware: [
        api => next => action => compose(...credentialMiddleware.map(mw => mw(api)))(next)(action),
        middleware,
        fetchEncodeJSON,
        fetchMw
      ],

      controller: {
        * invalidate (model, key) {
          yield invalidate(key)
        },

        * runFunction ({actions, props, state}, key, ...args) {
          const mapping = fn(props)
          return (yield actions.resolve(mapping[key](...args), state, true))
        },

        * resolve ({actions}, mapping, state, rethrow) {
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
                const request = actions.resolveUrl(key, descriptor, itemState, rethrow, descriptor.clear)

                resolvingKeys[key] = true

                if (descriptor.serialize && itemState.loading) {
                  yield actions.enqueue({key, request})
                } else {
                  paused.push(request)
                }
              } else if (descriptor.params) {
                resolvingKeys[key] = true
                paused.push(actions.resolveFragment(key, descriptor, itemState, rethrow))
              }
            }
          }

          for (const key in state) {
            const itemState = state[key]
            if (!itemState || !mapping[key]) continue

            const descriptor = typeof mapping[key] === 'string'
              ? {url: mapping[key]}
              : mapping[key]

            if (!resolvingKeys[key] && itemState.invalid.length) {
              paused.push(actions.resolveUrl(key, descriptor, itemState, rethrow, false))
            }
          }

          const result = yield paused

          return result.length === 1
            ? result[0]
            : result
        },

        * resolveUrl ({actions}, key, descriptor, state, rethrow, clear = true) {
          const {url, method = 'GET',  subscribe: subscribeKey, xf = identity, invalidates, ...fetchParams} = descriptor

          if (!url) throw new Error('vdux-summon: Did you forget to specify a url?')

          try {
            const isGet = /GET/i.test(method)

            yield actions.loading({
              subscribe: subscribeKey,
              method,
              url,
              key,
              clear,
              params: descriptor.params
            })

            const {value} = yield fetchJSON(getUrl(url, qs.stringify(descriptor.params)), {
              method,
              ...fetchParams
            })

            const xfVal = xf(config.transformResponse(value))

            if (state.invalid && state.invalid[0]) {
              state.invalid[0](null, xfVal)
              yield actions.shiftInvalidate(key)
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

            yield actions.success({
              url,
              key,
              value: xfVal
            })

            return xfVal
          } catch (err) {
            const xfErr = config.transformError(err)

            if (descriptor.autoretry) {
              yield actions.decinflight(key)
              yield sleep(1000)
              yield actions.resolveUrl(key, descriptor, state, rethrow, clear)
              return
            }

            if (state.invalid && state.invalid[0]) {
              state.invalid[0](xfErr)
              yield actions.shiftInvalidate(key)
            }

            yield actions.error({
              url,
              key,
              error: xfErr
            })

            if (rethrow) {
              throw xfErr
            }
          }
        },

        * resolveFragment ({actions}, key, descriptor, state, rethrow) {
          const {params, xf = identity, clear} = descriptor
          const merge = getMerge(descriptor.merge)
          const {url} = state
          const mergedParams = {...(state.params || {}), ...params}
          const prevValue = clear ? null : state.value

          if (!state.url) throw new Error('vdux-summon: Fragment can only be specified if an existing url has already been set for the collection')

          try {
            yield actions.loading({
              url,
              key,
              clear,
              params: mergedParams
            })

            let {value} = yield fetchJSON(getUrl(url, qs.stringify(mergedParams)))

            value = merge(prevValue, xf(config.transformResponse(value)))

            yield actions.success({url, key, value})
            return value
          } catch (err) {
            yield actions.error({
              url,
              key,
              error: config.transformError(err)
            })

            if (rethrow) {
              throw err
            }
          }
        }
      },

      reducer: {
        loading: (state, {key, method, url, clear, params, subscribe}) => ({
          [key]: {
            ...(state[key] || {}),
            method,
            url,
            subscribe,
            error: null,
            loading: true,
            inflight: ((state[key] || {}).inflight || 0) + 1,
            invalid: [],
            loaded: clear ? false : (state[key] || {}).loaded,
            value: clear ? null : (state[key] || {}).value,
            params
          }
        }),
        enqueue: (state, {key, request}) => ({
          [key]: state[key] && {
            ...state[key],
            queue: [...(state[key].queue || []), request]
          }
        }),
        shiftQueue: (state, key) => ({
          [key]: state[key] && {
            ...state[key],
            queue: state[key].queue.slice(1)
          }
        }),
        decinflight: (state, key) => ({
          [key]: state[key] && {
            ...state[key],
            inflight: state[key].inflight - 1
          }
        }),
        success: (state, {key, value}) => ({
          [key]: state[key] && {
            ...state[key],
            loading: state[key].inflight > 1 ? true : false,
            inflight: Math.max((state[key].inflight || 1) - 1, 0),
            hasLoaded: true,
            loaded: true,
            invalid: [],
            value
          }
        }),
        error: (state, {key, error}) => ({
          [key]: state[key] && {
            ...state[key],
            loading: state[key].inflight > 1 ? true : false,
            inflight: Math.max((state[key].inflight || 1) - 1, 0),
            value: null,
            invalid: [],
            error
          }
        }),
        [localInvalidate]: (state, key, cb) => {
          const newState = {}
          let changed = false

          for (let name in state) {
            const item = state[name]

            if (item && shouldInvalidate(item, key)) {
              newState[name] = {...item, invalid: [...(item.invalid || []), cb]}
              changed = true
            }
          }

          if (!changed) {
            cb()
            return state
          }

          return {
            ...newState
          }
        },
        shiftInvalidate: (state, name) => {
          if (!state || !state[name]) return

          const item = state[name]
          const invalid = (item.invalid || []).slice()

          invalid.shift()

          return {
            [name]: {
              ...item,
              invalid
            }
          }
        }
      },

      * onUpdate (prev, {props, state, actions}) {
        for (let key in state) {
          const desc = state[key]
          const pdesc = prev.state[key] || {}

          if (pdesc.loading && !desc.loading && desc.queue && desc.queue.length) {
            yield actions.shiftQueue(key)
            yield desc.queue[0]
          }
        }

        yield actions.resolve(fn(props), state)
      },

      onRemove ({path}) {
        return unsubscribe(path)
      }
    })

    return Component
  }
}

/**
 * Helpers
 */

function fetchJSON (url, params = {}) {
  if (params.method !== 'GET') {
    params = {
      ...params,
      headers: {
        'Content-Type': 'application/json',
        ...(params.headers || {})
      }
    }
  }

  return config.transformRequest(fetch(url, params))
}

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

/**
 * Exports
 */

export default connect
export {
  invalidate,
  middleware
}
