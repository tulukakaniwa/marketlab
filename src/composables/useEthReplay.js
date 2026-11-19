import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { replayAt } from '../domain/eth-replay/minute.js'

const query = new URLSearchParams(window.location.search)
const root = import.meta.env.BASE_URL + 'data/eth-decision/'
async function dataset(file) {
  const response = await fetch(root + file + '.json')
  if (!response.ok) throw new Error('无法读取回放数据（HTTP ' + response.status + '）')
  return response.json()
}

export function useEthReplay() {
  const index = shallowRef(null),
    month = shallowRef(null),
    error = ref('')
  const date = ref(''),
    minute = ref(0),
    playing = ref(false),
    speed = ref(1)
  const day = computed(() => month.value?.[date.value])
  const view = computed(() => day.value && replayAt(index.value, day.value, minute.value))
  const cache = new Map()
  let timer,
    generation = 0
  function jump(d, m) {
    if (!index.value?.days.includes(d) || !Number.isInteger(m)) return
    date.value = d
    minute.value = Math.min(1439, Math.max(0, m))
  }
  async function loadMonth(key) {
    const token = ++generation
    month.value = null
    error.value = ''
    try {
      const data = cache.get(key) ?? (await dataset(key))
      if (token !== generation) return
      cache.clear()
      cache.set(key, data)
      month.value = data
    } catch (e) {
      if (token === generation) {
        error.value = e.message
        playing.value = false
      }
    }
  }
  watch(
    () => date.value.slice(0, 7),
    (key) => {
      if (key) loadMonth(key)
    },
  )
  function step(delta) {
    if (!day.value) return
    const days = index.value.days
    const pos = days.indexOf(date.value) * 1440 + minute.value + delta
    if (pos < 0 || pos >= days.length * 1440) {
      playing.value = false
      return
    }
    jump(days[Math.floor(pos / 1440)], pos % 1440)
  }
  watch([playing, speed], ([active, rate]) => {
    clearInterval(timer)
    if (active) timer = setInterval(() => step(1), 1000 / rate)
  })
  async function start() {
    error.value = ''
    try {
      index.value = await dataset('index')
      const d = query.get('date'),
        m = Number(query.get('minute') ?? (d ? 0 : 194))
      jump(index.value.days.includes(d) ? d : '2022-09-26', Number.isInteger(m) ? m : 0)
    } catch (e) {
      error.value = e.message
    }
  }
  onMounted(start)
  onBeforeUnmount(() => {
    generation++
    clearInterval(timer)
  })
  return {
    index,
    date,
    minute,
    playing,
    speed,
    view,
    jump,
    step,
    error,
    retry: () => (date.value ? loadMonth(date.value.slice(0, 7)) : start()),
  }
}
