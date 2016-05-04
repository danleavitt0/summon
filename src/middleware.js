/**
 * Imports
 */

import createAction from '@f/create-action'
import forEach from '@f/foreach'

/**
 * Key/component maps
 */

const componentsToKeys = {}
const keysToComponents = {}

/**
 * Actions
 */

const invalidate = createAction('vdux-summon: Invalidate key')
const subscribe = createAction('vdux-summon: Register invalidation key')
const unsubscribe = createAction('vdux-summon: Deregister component')

/**
 * Middleware
 */

function middleware ({dispatch}) {
  return next => action => {
    switch (action.type) {
      // Register an invalidation key to a particular component
      case subscribe.type: {
        const {path, refresh, key} = action.payload
        const keys = componentsToKeys[path] = componentsToKeys[path] || []

        if (keys.indexOf(key) === -1) {
          keys.push(key)
        }

        const components = keysToComponents[key] = keysToComponents[key] || {}
        if (!components[path]) {
          components[path] = refresh
        }
      }
      break
      // Invalidate a key and re-render the components that
      // depend on it
      case invalidate.type: {
        const key = action.payload
        forEach(component => dispatch(component()), keysToComponents[key])
      }
      break
      // Deregister a component when it has been removed
      case unsubscribe.type: {
        const path = action.payload
        const keys = componentsToKeys[path] || []

        delete componentsToKeys[path]

        forEach(key => {
          const components = keysToComponents[key] || {}
          delete components[path]
        }, keys)
      }
      break
      default:
        return next(action)
    }
  }
}

/**
 * Exports
 */

export default middleware
export {
  subscribe,
  invalidate,
  unsubscribe
}
