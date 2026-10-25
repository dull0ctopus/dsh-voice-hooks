window.__ModuleLoader__.load({
  id: '@local/voice-hooks',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const EN = {
      summary: 'Voice hooks',
      sound: 'Sound',
      none: 'None',
      custom: 'custom',
      systemSounds: 'System',
      inputRequired: 'Input required',
      permissionRequired: 'Permission required',
      finished: 'Session finished',
      try: 'Try',
      trying: 'Trying…',
      previewFailed: 'Preview failed',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Could not save',
      loading: 'Loading…',
      unavailable: 'Configuration is unavailable.',
      readOnly: 'This configuration is read-only.',
    }

    const ZH = {
      summary: '语音钩子',
      sound: '提示音',
      none: '无',
      custom: '自定义',
      systemSounds: '系统',
      inputRequired: '需要输入时',
      permissionRequired: '请求权限时',
      finished: '会话完成时',
      try: '试听',
      trying: '试听中…',
      previewFailed: '试听失败',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败',
      loading: '正在读取…',
      unavailable: '配置不可用。',
      readOnly: '此配置为只读。',
    }

    const FIELDS = ['finished', 'permissionRequired', 'inputRequired', 'sound']

    // macOS system sound files installed at build time.
    const SOUNDS = [
      '/System/Library/Sounds/Basso.aiff',
      '/System/Library/Sounds/Blow.aiff',
      '/System/Library/Sounds/Bottle.aiff',
      '/System/Library/Sounds/Frog.aiff',
      '/System/Library/Sounds/Funk.aiff',
      '/System/Library/Sounds/Glass.aiff',
      '/System/Library/Sounds/Hero.aiff',
      '/System/Library/Sounds/Morse.aiff',
      '/System/Library/Sounds/Ping.aiff',
      '/System/Library/Sounds/Pop.aiff',
      '/System/Library/Sounds/Purr.aiff',
      '/System/Library/Sounds/Sosumi.aiff',
      '/System/Library/Sounds/Submarine.aiff',
      '/System/Library/Sounds/Tink.aiff',
    ]
    const SOUND_PATHS = new Set(SOUNDS)
    const soundLabel = (path) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      return name.replace(/\.[^.]+$/, '')
    }

    const formStyle = { display: 'grid', gap: '14px', maxWidth: '560px' }
    const fieldStyle = { display: 'grid', gap: '6px' }
    const fieldHeadStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      minHeight: '18px',
    }
    const labelStyle = {
      fontSize: '13px',
      fontWeight: 500,
      color: 'var(--dsw-alias-label-primary)',
    }
    const fieldMetaStyle = { display: 'flex', alignItems: 'center', gap: '8px' }
    const tryButtonStyle = (disabled) => ({
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-brand-primary)',
      fontSize: '12px',
      lineHeight: '16px',
      padding: '1px 6px',
      borderRadius: '4px',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    })
    const controlStyle = {
      width: '100%',
      boxSizing: 'border-box',
      height: '32px',
      padding: '6px 10px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      fontFamily: 'inherit',
    }
    const selectStyle = { ...controlStyle, cursor: 'pointer' }
    const actionsStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginTop: '2px',
    }
    const messageStyle = {
      fontSize: '13px',
      color: 'var(--dsw-alias-label-secondary)',
    }
    const readOnlyStyle = {
      fontSize: '12px',
      color: 'var(--dsw-alias-state-warn-primary)',
    }
    const noticeStyle = (failed) => ({
      fontSize: '12px',
      color: failed
        ? 'var(--dsw-alias-state-error-primary)'
        : 'var(--dsw-alias-state-success-primary)',
    })
    const primaryButtonStyle = (disabled) => ({
      padding: '6px 14px',
      borderRadius: '6px',
      border: '1px solid #247bbf',
      background: '#247bbf',
      color: '#fff',
      fontSize: '13px',
      fontWeight: 500,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    })

    function unwrap(value) {
      if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
        try {
          return value.get()
        } catch {
          return undefined
        }
      }
      return value
    }

    function textOf(value) {
      const plain = unwrap(value)
      return typeof plain === 'string' ? plain : ''
    }

    function toDraft(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      return {
        sound: textOf(source.sound),
        inputRequired: textOf(source.inputRequired),
        permissionRequired: textOf(source.permissionRequired),
        finished: textOf(source.finished),
      }
    }

    function Field({ t, id, label, onTry, trying, tryDisabled, children }) {
      return h('div', { style: fieldStyle }, [
        h('div', { key: 'head', style: fieldHeadStyle }, [
          h('label', { key: 'label', htmlFor: id, style: labelStyle }, t(label)),
          onTry
            ? h('div', { key: 'meta', style: fieldMetaStyle }, [
                h(
                  'button',
                  {
                    key: 'try',
                    type: 'button',
                    onClick: onTry,
                    disabled: tryDisabled || trying,
                    style: tryButtonStyle(tryDisabled || trying),
                  },
                  trying ? t('trying') : t('try'),
                ),
              ])
            : null,
        ]),
        children,
      ])
    }

    function VoiceHooksConfigPage({ t, view, form }) {
      const subscribe = React.useCallback(
        (onChange) => form.subscribe(onChange),
        [form],
      )
      const getSnapshot = React.useCallback(() => form.getSnapshot(), [form])
      const state = React.useSyncExternalStore(subscribe, getSnapshot)
      const [draft, setDraft] = React.useState(() => toDraft(state.value))
      const [dirty, setDirty] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [previewing, setPreviewing] = React.useState(null)
      const revisionRef = React.useRef(null)

      React.useEffect(() => {
        if (state.status !== 'ready') return
        if (revisionRef.current === null) {
          revisionRef.current = state.revision
          setDraft(toDraft(state.value))
          return
        }
        if (state.revision !== revisionRef.current) {
          revisionRef.current = state.revision
          if (!dirty) {
            setDraft(toDraft(state.value))
          }
        }
      }, [state.status, state.revision, dirty])

      if (view === 'summary') return t('summary')
      if (state.status !== 'ready') {
        return h(
          'p',
          { style: messageStyle },
          state.status === 'unavailable' ? t('unavailable') : t('loading'),
        )
      }

      const writable = state.writable !== false

      const update = (field, value) => {
        setDraft((current) => ({ ...current, [field]: value }))
        setDirty(true)
        setNotice('')
      }

      const preview = async (field) => {
        if (!writable || saving || previewing !== null) return
        const payload = {
          text: draft[field],
          sound: draft.sound,
          at: Date.now(),
        }
        setPreviewing(field)
        setNotice('')
        let ok = false
        try {
          ok = await form.mutate([
            { op: 'set', path: ['preview'], value: JSON.stringify(payload) },
          ])
        } catch {
          ok = false
        }
        setPreviewing(null)
        if (!ok) setNotice('previewFailed')
      }

      const save = async () => {
        if (!writable || saving) return
        const operations = []
        for (const field of FIELDS) {
          if (draft[field] !== textOf(state.value?.[field])) {
            operations.push({ op: 'set', path: [field], value: draft[field] })
          }
        }
        if (operations.length === 0) {
          setDirty(false)
          return
        }
        setSaving(true)
        setNotice('')
        let ok = false
        try {
          ok = await form.mutate(operations)
        } catch {
          ok = false
        }
        setSaving(false)
        if (ok) {
          setDirty(false)
          setNotice('saved')
        } else {
          setNotice('failed')
        }
      }

      const disabled = !writable || saving
      const soundField = h(Field, {
        key: 'sound',
        t,
        id: 'voice-hooks-sound',
        label: 'sound',
        children: h(
          'select',
          {
            id: 'voice-hooks-sound',
            value: draft.sound,
            disabled,
            onChange: (event) => update('sound', event.target.value),
            style: selectStyle,
          },
          [
            h('option', { key: 'none', value: '' }, t('none')),
            ...(draft.sound !== '' && !SOUND_PATHS.has(draft.sound)
              ? [
                  h(
                    'option',
                    { key: 'custom', value: draft.sound },
                    `${soundLabel(draft.sound)} (${t('custom')})`,
                  ),
                ]
              : []),
            h(
              'optgroup',
              { key: 'system', label: t('systemSounds') },
              SOUNDS.map((sound) =>
                h('option', { key: sound, value: sound }, soundLabel(sound)),
              ),
            ),
          ],
        ),
      })
      const tryDisabled = !writable || saving || previewing !== null
      const inputField = (field, label, id) =>
        h(Field, {
          key: field,
          t,
          id,
          label,
          onTry: () => preview(field),
          trying: previewing === field,
          tryDisabled,
          children: h('input', {
            id,
            type: 'text',
            value: draft[field],
            disabled,
            spellCheck: false,
            autoComplete: 'off',
            onChange: (event) => update(field, event.target.value),
            style: controlStyle,
          }),
        })

      return h('div', { style: formStyle }, [
        h(
          'style',
          { key: 'hide-components' },
          '[data-plugin-detail="@local/voice-hooks"] [data-plugin-rows]{display:none!important;}',
        ),
        inputField('finished', 'finished', 'voice-hooks-finished'),
        inputField('permissionRequired', 'permissionRequired', 'voice-hooks-permission'),
        inputField('inputRequired', 'inputRequired', 'voice-hooks-input'),
        soundField,
        h('div', { key: 'actions', style: actionsStyle }, [
          h(
            'button',
            {
              key: 'save',
              type: 'button',
              onClick: save,
              disabled: disabled || !dirty,
              style: primaryButtonStyle(disabled || !dirty),
            },
            saving ? t('saving') : t('save'),
          ),
          notice === ''
            ? null
            : h(
                'span',
                {
                  key: 'notice',
                  role: 'status',
                  style: noticeStyle(
                    notice === 'failed' || notice === 'previewFailed',
                  ),
                },
                t(notice),
              ),
        ]),
        writable
          ? null
          : h('p', { key: 'readOnly', style: readOnlyStyle }, t('readOnly')),
      ])
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get('voice-hooks')
        const Page = (props) => h(VoiceHooksConfigPage, { ...props, form })

        ctx.effect(
          () => ctx.locale.register('voiceHooks', { en: EN, zh: ZH }),
          'voice-hooks:locale',
        )
        ctx.effect(
          () =>
            ctx.configForms.whileServed(['voice-hooks'], () =>
              ctx.slots.inject('plugins.bundle.config', () =>
                ctx.slots.register(
                  {
                    name: 'plugins.bundle.config',
                    key: '@local/voice-hooks',
                    locale: 'voiceHooks',
                  },
                  Page,
                ),
              ),
            ),
          'voice-hooks:page',
        )
      },
    }
  },
})
