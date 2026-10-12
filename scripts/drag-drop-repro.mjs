import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appUrl = 'http://127.0.0.1:4178/'
const debugUrl = 'http://127.0.0.1:9333'
const chromium =
  process.env.CHROMIUM_PATH ??
  '/home/exedev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'

const profile = await mkdtemp(join(tmpdir(), 'crepe-drag-repro-'))
const vite = spawn('./node_modules/.bin/vite', [
  '--host',
  '127.0.0.1',
  '--port',
  '4178',
  '--strictPort',
], { stdio: 'ignore' })
const chrome = spawn(chromium, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1400,900',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=9333',
  'about:blank',
], { stdio: 'ignore' })

async function retry(read, description) {
  const deadline = Date.now() + 10_000
  let error
  while (Date.now() < deadline) {
    try {
      return await read()
    } catch (caught) {
      error = caught
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: error })
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 0
    socket.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          const id = ++nextId
          socket.send(JSON.stringify({ id, method, params }))
          return new Promise((resolveCall, rejectCall) => {
            pending.set(id, { resolve: resolveCall, reject: rejectCall })
          })
        },
        close: () => socket.close(),
      })
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
  })
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails))
  }
  return result.result.value
}

try {
  await retry(async () => {
    const response = await fetch(appUrl)
    if (!response.ok) throw new Error(`Vite returned ${response.status}`)
  }, 'Vite')
  const target = await retry(async () => {
    const response = await fetch(`${debugUrl}/json/new`, {
      method: 'PUT',
    })
    if (!response.ok) throw new Error(`Chromium returned ${response.status}`)
    return response.json()
  }, 'Chromium')
  const client = await connect(target.webSocketDebuggerUrl)
  await client.call('Runtime.enable')
  await client.call('Page.enable')
  await client.call('Page.navigate', { url: appUrl })
  await retry(async () => {
    const ready = await evaluate(
      client,
      `location.href === ${JSON.stringify(appUrl)} && document.readyState === "complete"`,
    )
    if (!ready) throw new Error('page is not loaded')
  }, 'the initial page')

  const authoring = {
    questionBank: {
      questions: ['q1', 'q2'].map((id) => ({
        id,
        type: 'open',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
        },
        columns: 2,
      })),
    },
    workingCopy: { title: 'Drag test', questionIds: ['q1', 'q2'] },
    dirty: false,
  }
  // Driven over CDP rather than Playwright, so this is the one place the
  // storage key is written out rather than imported from `exam-store.ts`.
  await evaluate(
    client,
    `localStorage.setItem('exam-authoring-v2', ${JSON.stringify(JSON.stringify(authoring))})`,
  )
  await client.call('Page.reload')
  await retry(async () => {
    const count = await evaluate(
      client,
      'document.querySelectorAll("[data-question-id]").length',
    )
    if (count !== 2) throw new Error(`found ${count} questions`)
  }, 'two rendered questions')

  await evaluate(client, `(() => {
    window.__nativeDragStarts = 0
    document.addEventListener('dragstart', () => {
      window.__nativeDragStarts += 1
    })
  })()`)

  const dragQuestion = async (sourceId, targetId, placement, releaseAt) => {
    const bounds = await evaluate(client, `(() => {
      const rect = (id) => {
        const { left, top, width, height } = document
          .querySelector('[data-question-id="' + id + '"]')
          .getBoundingClientRect()
        return { left, top, width, height }
      }
      return { source: rect(${JSON.stringify(sourceId)}), target: rect(${JSON.stringify(targetId)}) }
    })()`)
    const source = {
      x: bounds.source.left + 120,
      y: bounds.source.top + bounds.source.height / 2,
    }
    const marker = {
      x: bounds.target.left + 120,
      y: placement === 'before'
        ? bounds.target.top + 1
        : bounds.target.top + bounds.target.height - 1,
    }
    await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...source })
    await client.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...source,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    for (let step = 1; step <= 5; step += 1) {
      await client.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: source.x + ((marker.x - source.x) * step) / 5,
        y: source.y + ((marker.y - source.y) * step) / 5,
        button: 'left',
        buttons: 1,
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    const visibleMarker = await evaluate(
      client,
      `document.querySelector('[data-question-id=${JSON.stringify(targetId)}]').dataset.drop`,
    )
    const release = releaseAt?.(bounds.target) ?? marker
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...release,
      button: 'left',
      buttons: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const during = await evaluate(client, `(() => {
      const underPointer = document.elementFromPoint(
        ${JSON.stringify(release.x)},
        ${JSON.stringify(release.y)},
      )
      return {
        cursor: getComputedStyle(underPointer).cursor,
        nativeDragStarts: window.__nativeDragStarts,
        customPreview: Boolean(document.querySelector('.question-drag-preview')),
        releaseTarget: underPointer.className,
      }
    })()`)
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...release,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const order = await evaluate(
      client,
      `[...document.querySelectorAll('[data-question-id]')]
        .map((question) => question.dataset.questionId)`,
    )
    return { marker: visibleMarker, ...during, order, release }
  }

  const deadSpaceResult = {
    gap: await dragQuestion('q2', 'q1', 'before', (target) => ({
      x: target.left + 20,
      y: target.top - 17,
    })),
    outside: await dragQuestion('q1', 'q2', 'before', (target) => ({
      x: 2,
      y: target.top + 1,
    })),
  }

  // Move q1 after q2: the release point remains over q2 while q1 lands below
  // it, exposing feedback that follows the pointer instead of the moved item.
  const feedbackDrag = await dragQuestion('q1', 'q2', 'after')
  const dragFeedback = {
    cursor: feedbackDrag.cursor,
    nativeDragStarts: feedbackDrag.nativeDragStarts,
    customPreview: feedbackDrag.customPreview,
  }
  const feedbackResult = await evaluate(client, `(() => {
    const question = (id) => document.querySelector('[data-question-id="' + id + '"]')
    return {
      order: [...document.querySelectorAll('[data-question-id]')]
        .map((item) => item.dataset.questionId),
      hovered: [...document.querySelectorAll('.exam-question:hover')]
        .map((item) => item.dataset.questionId),
      sourceBackground: getComputedStyle(question('q1')).backgroundColor,
      displacedBackground: getComputedStyle(question('q2')).backgroundColor,
    }
  })()`)
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: feedbackDrag.release.x + 1,
    y: feedbackDrag.release.y,
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const resumedHoverResult = await evaluate(client, `(() => {
    const question = (id) => document.querySelector('[data-question-id="' + id + '"]')
    return {
      dropFeedback: document.querySelector('.exam-workspace')
        .classList.contains('exam-workspace--drop-feedback'),
      sourceBackground: getComputedStyle(question('q1')).backgroundColor,
      displacedBackground: getComputedStyle(question('q2')).backgroundColor,
    }
  })()`)
  const clickPoint = await evaluate(client, `(() => {
    const bounds = document.querySelector('[data-question-id="q2"]')
      .getBoundingClientRect()
    return { x: bounds.left + 120, y: bounds.top + bounds.height / 2 }
  })()`)
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...clickPoint })
  await client.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...clickPoint,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await client.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...clickPoint,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const clickResult = await evaluate(client, `({
    selected: document.querySelector('[data-question-id="q2"]')
      .classList.contains('exam-question--selected'),
    customPreview: Boolean(document.querySelector('.question-drag-preview')),
  })`)
  client.close()

  const result = {
    deadSpace: deadSpaceResult,
    dragFeedback,
    feedback: feedbackResult,
    resumedHover: resumedHoverResult,
    click: clickResult,
  }
  console.log(JSON.stringify(result))
  if (
    result.deadSpace.gap.marker !== 'before' ||
    result.deadSpace.gap.nativeDragStarts !== 0 ||
    !result.deadSpace.gap.customPreview ||
    JSON.stringify(result.deadSpace.gap.order) !== JSON.stringify(['q2', 'q1']) ||
    result.deadSpace.outside.marker !== 'before' ||
    result.deadSpace.outside.nativeDragStarts !== 0 ||
    !result.deadSpace.outside.customPreview ||
    JSON.stringify(result.deadSpace.outside.order) !== JSON.stringify(['q1', 'q2']) ||
    result.dragFeedback.cursor !== 'grabbing' ||
    result.dragFeedback.nativeDragStarts !== 0 ||
    !result.dragFeedback.customPreview ||
    JSON.stringify(result.feedback.order) !== JSON.stringify(['q2', 'q1']) ||
    result.feedback.sourceBackground !== 'rgb(246, 241, 232)' ||
    result.feedback.displacedBackground !== 'rgba(0, 0, 0, 0)' ||
    result.resumedHover.dropFeedback ||
    !result.click.selected ||
    result.click.customPreview
  ) {
    process.exitCode = 1
  }
} finally {
  vite.kill('SIGTERM')
  chrome.kill('SIGTERM')
  if (chrome.exitCode === null) {
    await new Promise((resolve) => chrome.once('exit', resolve))
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
