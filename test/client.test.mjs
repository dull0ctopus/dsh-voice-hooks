import assert from 'node:assert/strict'

let registration
const localeCalls = []
const formCalls = []
const servedCalls = []
const mutateCalls = []

const readyState = {
  status: 'ready',
  value: {
    sound: '/System/Library/Sounds/Ping.aiff',
    inputRequired: 'Input required',
    permissionRequired: 'Permission required',
    finished: 'DeepSeek finished',
  },
  base: {
    sound: '/System/Library/Sounds/Ping.aiff',
    inputRequired: 'Input required',
    permissionRequired: 'Permission required',
    finished: 'DeepSeek finished',
  },
  user: {},
  revision: 1,
  writable: true,
}

function find(node, type) {
  if (node === null || typeof node !== 'object') return undefined
  if (node.type === type) return node
  const children = node.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = find(child, type)
      if (found !== undefined) return found
    }
  } else {
    return find(children, type)
  }
  return undefined
}

function findAll(node, type, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (node.type === type) out.push(node)
  const children = node.props?.children
  if (Array.isArray(children)) {
    for (const child of children) findAll(child, type, out)
  } else {
    findAll(children, type, out)
  }
  return out
}

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.equal(id, '@local/voice-hooks')
      const h = (type, props, ...children) => {
        const merged = { ...(props || {}) }
        if (children.length === 1) merged.children = children[0]
        else if (children.length > 1) merged.children = children
        if (typeof type === 'function') return type(merged)
        return { type, props: merged }
      }
      const React = {
        createElement: h,
        useState(initial) {
          return [typeof initial === 'function' ? initial() : initial, () => {}]
        },
        useEffect() {},
        useRef(initial) {
          return { current: initial }
        },
        useCallback(fn) {
          return fn
        },
        useSyncExternalStore(_subscribe, getSnapshot) {
          return getSnapshot()
        },
      }
      const plugin = factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require: ${name}`)
      })
      const form = {
        getSnapshot: () => readyState,
        subscribe: () => () => {},
        mutate(ops) {
          mutateCalls.push(ops)
          return Promise.resolve(true)
        },
      }
      const fakeCtx = {
        effect(fn) {
          return fn()
        },
        locale: {
          register(namespace, dictionaries) {
            localeCalls.push({ namespace, dictionaries })
            return () => {}
          },
        },
        configForms: {
          get(namespace) {
            formCalls.push(namespace)
            return form
          },
          whileServed(namespaces, callback) {
            servedCalls.push(namespaces)
            return callback(new Set(namespaces))
          },
        },
        slots: {
          inject(key, callback) {
            assert.equal(key, 'plugins.bundle.config')
            return callback()
          },
          register(options, component) {
            registration = { options, component }
            return () => {}
          },
        },
      }
      plugin.apply(fakeCtx)
    },
  },
}

await import('../client.js')

assert.ok(registration, 'the bundle configuration page must register')
assert.equal(registration.options.name, 'plugins.bundle.config')
assert.equal(registration.options.key, '@local/voice-hooks')
assert.equal(registration.options.locale, 'voiceHooks')
assert.equal(typeof registration.component, 'function')
assert.deepEqual(formCalls, ['voice-hooks'])
assert.deepEqual(servedCalls, [['voice-hooks']])
assert.equal(localeCalls.length, 1)
assert.equal(localeCalls[0].namespace, 'voiceHooks')
assert.equal(localeCalls[0].dictionaries.en.finished, 'Session finished')
assert.equal(localeCalls[0].dictionaries.en.voice, undefined)
assert.equal(localeCalls[0].dictionaries.en.systemDefault, undefined)
assert.equal(localeCalls[0].dictionaries.zh.finished, '会话完成时')
assert.equal(localeCalls[0].dictionaries.en.coAuthor, undefined)

const rendered = registration.component({ t: (key) => key, view: 'page' })
assert.ok(rendered, 'the page component must render')
const hideStyle = find(rendered, 'style')
assert.ok(hideStyle, 'the page must hide the redundant Components section')
assert.match(hideStyle.props.children, /@local\/voice-hooks/)
assert.match(hideStyle.props.children, /data-plugin-rows/)
const selects = findAll(rendered, 'select')
assert.equal(selects.length, 1)
const soundSelect = selects.find((item) => item.props.id === 'voice-hooks-sound')
assert.ok(soundSelect, 'the sound field must render a select')
assert.equal(soundSelect.props.value, '/System/Library/Sounds/Ping.aiff')
assert.equal(soundSelect.props.children[0].props.value, '')
assert.ok(findAll(rendered, 'optgroup').length >= 1, 'the sound select must group its options')
const inputs = findAll(rendered, 'input')
assert.deepEqual(
  inputs.map((input) => input.props.id),
  ['voice-hooks-finished', 'voice-hooks-permission', 'voice-hooks-input'],
)

const buttons = findAll(rendered, 'button')
assert.equal(buttons.some((button) => button.props.children === 'discard'), false)
assert.equal(buttons.some((button) => button.props.children === 'reset'), false)
assert.equal(
  findAll(rendered, 'span').some((span) => span.props.children === 'overridden'),
  false,
)
const saveButton = buttons.find((button) => button.props.children === 'save')
assert.ok(saveButton, 'the form must render a Save button')
assert.equal(saveButton.props.style.background, '#247bbf')
assert.equal(saveButton.props.style.color, '#fff')

const tryButtons = buttons.filter((button) => button.props.children === 'try')
assert.equal(tryButtons.length, 3, 'the three message fields must render Try buttons')
await tryButtons[0].props.onClick()
assert.equal(mutateCalls.length, 1)
const previewOp = mutateCalls[0][0]
assert.equal(previewOp.op, 'set')
assert.deepEqual(previewOp.path, ['preview'])
const previewPayload = JSON.parse(previewOp.value)
assert.equal(previewPayload.text, 'DeepSeek finished')
assert.equal(previewPayload.sound, '/System/Library/Sounds/Ping.aiff')
assert.equal(previewPayload.voice, undefined)
assert.equal(typeof previewPayload.at, 'number')

console.log('voice-hooks client: registration and form assertions passed')
