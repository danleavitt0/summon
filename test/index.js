/**
 * Imports
 */

import fixture, {responses} from 'redux-effects-fetch-fixture'
import summon, {invalidate, middleware} from '../src'
import element from 'vdux/element'
import flo from 'redux-flo'
import vdux from 'vdux/dom'
import test from 'tape'

/**
 * Tests
 */

test('should work', t => {
  let node
  const {render} = vdux({
    middleware: [
      flo(),
      fixture({
        '/test': {
          GET: () => responses.ok('some test string')
        }
      })
    ]
  })

  const App = summon(props => ({
    test: '/test'
  }), {
    render: ({props}) => {
      return <div>{props.test.loading ? 'loading' : props.test.value}</div>
    }
  })

  node = render(<App/>)
  t.ok(node.innerText.indexOf('loading') !== -1, 'loading state')

  setTimeout(() => {
    node = render(<App/>)
    t.ok(node.innerText.indexOf('some test string') !== -1, 'data loaded')

    t.end()
  })
})

test('should support invalidation', t => {
  let node
  const {render, dispatch} = vdux({
    middleware: [
      flo(),
      middleware,
      fixture({
        '/test': {
          GET: () => {
            responses.ok('some test string')
            t.pass()
          }
        }
      })
    ]
  })

  const App = summon(props => ({
    test: '/test'
  }), {
    render: ({props}) => {
      return <div>{props.test.loading ? 'loading' : props.test.value}</div>
    }
  })

  node = render(<App/>)

  t.plan(2)
  setTimeout(() => {
    node = render(<App/>)
    dispatch(invalidate('/test'))

    setTimeout(() => {
      render(<span/>)
      dispatch(invalidate('/test'))
      setTimeout(() => t.end())
    })
  })
})
