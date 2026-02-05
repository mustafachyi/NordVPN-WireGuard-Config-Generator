<script setup>
import { onMounted, onUnmounted, ref, watch, nextTick, computed } from 'vue'
import { useServers } from '@/composables/useServers'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import { api } from '@/services/apiService'
import ServerCard from '@/components/ServerCard.vue'
import Toast from '@/components/Toast.vue'
import Icon from '@/components/Icon.vue'
import ConfigCustomizer from '@/components/ConfigCustomizer.vue'
import KeyGenerator from '@/components/KeyGenerator.vue'

const srv = useServers()
const cfg = useConfig()
const ui = useUI()
const notif = useToast()

const sentinel = ref(null)
const headerRef = ref(null)
const headerHeight = ref(0)
const dlLoading = ref(false)
let obs = null
let ro = null
let ticking = false

const mainView = computed(() => !ui.modals.value.key && !ui.modals.value.custom)
const emptyMsg = computed(() => srv.fCountry.value ? 'No servers match criteria.' : 'No servers loaded.')
const dlLabel = computed(() => dlLoading.value ? 'Processing...' : srv.fCity.value ? 'Download City' : srv.fCountry.value ? 'Download Country' : 'Download All')

const onScroll = () => {
  if (!ticking) {
    window.requestAnimationFrame(() => {
      ui.topBtn.value = window.scrollY > 500
      ticking = false
    })
    ticking = true
  }
}

const observe = async () => {
  await nextTick()
  obs?.disconnect()
  if (sentinel.value) obs?.observe(sentinel.value)
}

const genKey = async t => {
  try {
    const { key } = await api.genKey(t)
    cfg.setKey(key)
    ui.modals.value.key = false
    notif.show('Key generated', 'success')
  } catch (e) {
    notif.show(e.message || 'Generation failed', 'error')
  }
}

const applyCfg = c => {
  try {
    cfg.setKey(c.privateKey)
    cfg.save(c)
    ui.modals.value.custom = false
    notif.show('Settings applied', 'success')
  } catch (e) {
    notif.show(e.message, 'error')
  }
}

const dl = async s => {
  try { await cfg.dl(s); notif.show('Downloaded', 'success') }
  catch (e) { notif.show(e.message || 'Download failed', 'error') }
}

const dlBatch = async () => {
  if (dlLoading.value) return
  dlLoading.value = true
  notif.show('Compressing...', 'success')
  try {
    await cfg.dlBatch({ country: srv.fCountry.value, city: srv.fCity.value })
    notif.show('Download started', 'success')
  } catch (e) {
    notif.show(e.message || 'Batch download failed', 'error')
  } finally {
    dlLoading.value = false
  }
}

const cp = async s => {
  try { await cfg.copy(s); notif.show('Copied', 'success') }
  catch (e) { notif.show(e.message || 'Copy failed', 'error') }
}

const qr = s => {
  ui.showQR(s, () => api.genQR(cfg.make(s)))
    .catch(e => notif.show(e.message || 'QR generation failed', 'error'))
}

onMounted(async () => {
  window.scrollTo(0, 0)
  cfg.load()
  await srv.init()
  
  obs = new IntersectionObserver(e => {
    if (e[0].isIntersecting) srv.loadMore()
  }, { rootMargin: '200px' })
  
  ro = new ResizeObserver(() => {
    headerHeight.value = headerRef.value?.offsetHeight || 0
  })
  if (headerRef.value) ro.observe(headerRef.value)
  
  observe()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  obs?.disconnect()
  ro?.disconnect()
  window.removeEventListener('scroll', onScroll)
  ui.cleanQR()
})

watch([srv.fCountry, srv.fCity], observe)
</script>

<template>
  <Toast v-if="notif.toast.value" :msg="notif.toast.value.message" :type="notif.toast.value.type" @close="notif.toast.value = null" />

  <div v-if="ui.modals.value.qr" class="fixed inset-0 z-[100] flex items-center justify-center p-4" @click="ui.modals.value.qr = false">
    <div class="fixed inset-0 bg-nord-bg-overlay" />
    <div class="relative bg-vscode-bg rounded-lg border border-vscode-active overflow-hidden max-w-sm w-full" @click.stop>
      <div class="bg-nord-bg-overlay-light px-3 py-1.5 text-xs font-medium border-b border-vscode-active flex items-center justify-between text-nord-text-primary">
        <span>{{ ui.server.value?.dName }}</span>
        <button @click="ui.modals.value.qr = false" class="p-1 rounded hover:bg-nord-bg-hover"><Icon name="close" class="w-3.5 h-3.5" /></button>
      </div>
      <div class="p-6 flex justify-center">
        <img :src="ui.qrUrl.value" class="w-[200px] h-[200px] rounded">
      </div>
    </div>
  </div>

  <KeyGenerator v-if="ui.modals.value.key" @generate="genKey" @cancel="ui.modals.value.key = false" />

  <ConfigCustomizer v-if="ui.modals.value.custom" :session-private-key="cfg.privKey.value" :persisted-settings="cfg.settings.value" :default-settings="cfg.defaults" @apply="applyCfg" @cancel="ui.modals.value.custom = false" />

  <div v-show="mainView" class="min-h-screen bg-vscode-bg text-vscode-text">
    <header ref="headerRef" class="sticky top-0 z-50 bg-vscode-header border-b border-vscode-active">
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-2">
        <nav class="flex items-center gap-2 flex-1">
          <button @click="ui.toggle" class="shrink-0 p-2 flex items-center justify-center rounded hover:bg-nord-bg-hover"><Icon name="menu" class="w-5 h-5" /></button>
          <div class="flex-1 flex gap-2" @click="ui.close">
            <select v-model="srv.fCountry.value" class="w-full bg-vscode-bg border border-vscode-active rounded px-2 py-1.5 text-sm sm:w-[200px]">
              <option value="">All Countries</option>
              <option v-for="c in srv.countries.value" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <div v-if="srv.fCountry.value" class="w-full sm:w-[200px]">
              <select v-model="srv.fCity.value" :disabled="srv.cities.value.length < 2" class="w-full bg-vscode-bg border border-vscode-active rounded px-2 py-1.5 text-sm disabled:opacity-50">
                <option v-if="srv.cities.value.length > 1" value="">All Cities</option>
                <option v-for="c in srv.cities.value" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
        </nav>
        <div class="sm:pl-0 pl-[calc(2.25rem+0.5rem)]">
          <div class="flex flex-wrap items-center justify-end gap-2 text-xs" @click="ui.close">
            <button @click="dlBatch" :disabled="dlLoading" class="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-nord-button-primary text-white font-semibold hover:bg-nord-button-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              <div v-if="dlLoading" class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <Icon v-else name="archive" class="w-4 h-4" />
              <span class="whitespace-nowrap">{{ dlLabel }}</span>
            </button>
            <button @click="srv.toggleSort('load')" class="flex-1 sm:flex-none flex items-center justify-center gap-1 sm:min-w-[80px] px-2 sm:px-3 py-1.5 rounded border font-semibold transition-colors" :class="srv.sortKey.value === 'load' ? 'bg-nord-bg-active border-vscode-accent text-white' : 'border-vscode-active hover:bg-nord-bg-hover'">
              <span>Load</span><Icon v-if="srv.sortKey.value === 'load'" :name="srv.sortOrd.value === 'asc' ? 'sortAsc' : 'sortDesc'" class="w-4 h-4" />
            </button>
            <button @click="srv.toggleSort('name')" class="flex-1 sm:flex-none flex items-center justify-center gap-1 sm:min-w-[80px] px-2 sm:px-3 py-1.5 rounded border font-semibold transition-colors" :class="srv.sortKey.value === 'name' ? 'bg-nord-bg-active border-vscode-accent text-white' : 'border-vscode-active hover:bg-nord-bg-hover'">
              <span>A-Z</span><Icon v-if="srv.sortKey.value === 'name'" :name="srv.sortOrd.value === 'asc' ? 'sortAsc' : 'sortDesc'" class="w-4 h-4" />
            </button>
            <div class="px-3 py-1.5 rounded bg-vscode-bg/50 border border-vscode-active/50"><span class="text-xs text-nord-text-secondary font-semibold">{{ srv.total }}</span></div>
          </div>
        </div>
      </div>
    </header>

    <div class="fixed inset-0 bg-nord-bg-overlay/30 z-30 transition-opacity" :class="ui.panel.value ? 'opacity-100' : 'opacity-0 pointer-events-none'" @click="ui.close" />
    <aside class="fixed inset-y-0 left-0 w-1/2 sm:w-[252px] bg-vscode-header border-r border-vscode-active z-40 transition-transform flex flex-col" :class="ui.panel.value ? 'translate-x-0' : '-translate-x-full'">
      <div :style="{ height: headerHeight + 'px' }" class="shrink-0 bg-vscode-header transition-[height]" />
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        <button @click="ui.openCustom" class="w-full px-2 sm:px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-xs sm:text-sm hover:bg-nord-bg-hover"><div class="flex items-center gap-1.5 sm:gap-2"><Icon name="settings" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-vscode-accent" /><span>Customize</span></div></button>
        <button @click="ui.openKey" class="w-full px-2 sm:px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-xs sm:text-sm hover:bg-nord-bg-hover"><div class="flex items-center gap-1.5 sm:gap-2"><Icon name="key" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-vscode-accent" /><span>Generate Key</span></div></button>
        <label class="flex items-center justify-between cursor-pointer group mt-4 select-none">
          <span class="text-xs sm:text-sm font-medium text-nord-text-primary">Show IP</span>
          <button type="button" @click="ui.showIp.value = !ui.showIp.value" class="relative w-8 h-4 sm:w-10 sm:h-5 rounded-full transition-colors" :class="ui.showIp.value ? 'bg-nord-button-primary' : 'bg-nord-button-secondary'">
            <span class="absolute left-0.5 top-0.5 w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-white transition-transform" :class="ui.showIp.value ? 'translate-x-[16px] sm:translate-x-[18px]' : ''" />
          </button>
        </label>
      </div>
      <div class="p-4 space-y-3 border-t border-vscode-active bg-nord-bg-overlay/20">
        <a href="https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator" target="_blank" class="block w-full px-2 sm:px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-xs sm:text-sm hover:bg-nord-bg-hover"><div class="flex items-center gap-1.5 sm:gap-2"><Icon name="github" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-vscode-accent" /><span>Star on GitHub</span></div></a>
        <a href="https://refer-nordvpn.com/MXIVDoJGpKT" target="_blank" class="block w-full px-2 sm:px-4 py-2 rounded border border-vscode-active bg-nord-bg-overlay/20 text-xs sm:text-sm hover:bg-nord-bg-hover"><div class="flex items-center gap-1.5 sm:gap-2"><Icon name="externalLink" class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-vscode-accent" /><span>Get NordVPN</span></div></a>
      </div>
    </aside>

    <main class="container mx-auto px-4 py-6">
      <div v-if="srv.visible.value.length > 0" class="server-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mx-auto group/grid" :class="{ 'show-ips': ui.showIp.value }">
        <ServerCard v-for="s in srv.visible.value" v-memo="[s]" :key="s.name" :s="s" @download="dl(s)" @copy="cp(s)" @show-qr="qr(s)" @copy-ip="notif.show('IP copied', 'success')" />
      </div>
      <div v-else-if="!srv.loading.value" class="text-center py-20">
        <Icon name="error" class="w-12 h-12 mx-auto text-nord-text-secondary/50 mb-4" />
        <p class="text-nord-text-secondary font-medium">{{ emptyMsg }}</p>
      </div>
      <div ref="sentinel" class="h-10" />
      <div v-if="srv.loading.value" class="flex justify-center py-4"><div class="w-6 h-6 border-2 border-vscode-accent border-t-transparent rounded-full animate-spin" /></div>
    </main>

    <button v-show="ui.topBtn.value" @click="ui.top" class="fixed bottom-4 right-4 p-2 rounded-full bg-vscode-header/90 border border-vscode-accent z-50 hover:bg-vscode-header"><Icon name="arrowUp" class="w-5 h-5" /></button>
  </div>
</template>