<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useServers } from '@/composables/useServers'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import Icon from '@/components/Icon.vue'

const servers = useServers()
const config = useConfig()
const ui = useUI()
const notifications = useToast()

const headerRef = ref(null)
const downloadLoading = ref(false)
let resizeObserver = null

const downloadLabel = computed(() => {
  if (downloadLoading.value) return 'Preparing...'
  if (servers.selectedCity.value) return 'Download City'
  if (servers.selectedCountry.value) return 'Download Country'
  if (servers.selectedGroup.value) return 'Download Group'
  return 'Download All'
})

const downloadBatch = async () => {
  if (downloadLoading.value) return

  downloadLoading.value = true
  notifications.show('Preparing archive...', 'success')
  await new Promise(resolve => setTimeout(resolve, 50))

  try {
    config.downloadBatch(servers.filteredServers.value, {
      group: servers.selectedGroupName.value,
      country: servers.selectedCountry.value,
      city: servers.selectedCity.value,
    })
    notifications.show('Download started', 'success')
  } catch (error) {
    notifications.show(error.message || 'Batch download failed', 'error')
  } finally {
    downloadLoading.value = false
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    ui.headerHeight.value = headerRef.value?.offsetHeight || 0
  })

  if (headerRef.value) {
    resizeObserver.observe(headerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <header
    ref="headerRef"
    class="sticky top-0 z-50 bg-app-surface border-b border-app-border"
  >
    <div class="flex flex-col sm:flex-row sm:items-center gap-2 p-2">
      <nav class="flex items-center gap-2 flex-1 min-w-0">
        <button
          type="button"
          :aria-label="ui.panel.value ? 'Close navigation' : 'Open navigation'"
          aria-controls="app-sidebar"
          :aria-expanded="ui.panel.value"
          class="shrink-0 p-2 flex items-center justify-center rounded hover:bg-nord-bg-hover"
          @click="ui.toggle"
        >
          <Icon name="menu" class="w-5 h-5" />
        </button>

        <div class="flex-1 flex gap-2 min-w-0" @click="ui.close">
          <select
            v-model="servers.selectedGroup.value"
            aria-label="Server group"
            class="w-full truncate bg-app-bg border border-app-border rounded px-2 py-1.5 text-sm sm:w-40"
          >
            <option value="">All Groups</option>
            <option
              v-for="group in servers.serverGroups"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }}
            </option>
          </select>

          <select
            v-model="servers.selectedCountry.value"
            aria-label="Country"
            :disabled="servers.availableCountries.value.length === 0"
            class="w-full truncate bg-app-bg border border-app-border rounded px-2 py-1.5 text-sm sm:w-50 disabled:opacity-50"
          >
            <option value="">All Countries</option>
            <option
              v-for="country in servers.availableCountries.value"
              :key="country.id"
              :value="country.id"
            >
              {{ country.name }}
            </option>
          </select>

          <div v-if="servers.selectedCountry.value" class="w-full sm:w-50 min-w-0">
            <select
              v-model="servers.selectedCity.value"
              aria-label="City"
              :disabled="servers.availableCities.value.length < 2"
              class="w-full truncate bg-app-bg border border-app-border rounded px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option v-if="servers.availableCities.value.length > 1" value="">
                All Cities
              </option>
              <option
                v-for="city in servers.availableCities.value"
                :key="city.id"
                :value="city.id"
              >
                {{ city.name }}
              </option>
            </select>
          </div>
        </div>
      </nav>

      <div class="sm:pl-0 pl-11">
        <div
          class="flex flex-wrap items-center justify-end gap-2 text-xs"
          @click="ui.close"
        >
          <button
            type="button"
            :disabled="downloadLoading"
            class="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-nord-button-primary text-white font-semibold hover:bg-nord-button-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="downloadBatch"
          >
            <div
              v-if="downloadLoading"
              class="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
            />
            <Icon v-else name="archive" class="w-4 h-4" />
            <span class="whitespace-nowrap">{{ downloadLabel }}</span>
          </button>

          <button
            type="button"
            class="flex-1 sm:flex-none flex items-center justify-center gap-1 sm:min-w-20 px-2 sm:px-3 py-1.5 rounded border font-semibold transition-colors"
            :class="servers.sortField.value === 'load'
              ? 'bg-nord-bg-active border-app-accent text-white'
              : 'border-app-border hover:bg-nord-bg-hover'"
            @click="servers.toggleSort('load')"
          >
            <span>Load</span>
            <Icon
              v-if="servers.sortField.value === 'load'"
              :name="servers.sortOrder.value === 'asc' ? 'sortAsc' : 'sortDesc'"
              class="w-4 h-4"
            />
          </button>

          <button
            type="button"
            class="flex-1 sm:flex-none flex items-center justify-center gap-1 sm:min-w-20 px-2 sm:px-3 py-1.5 rounded border font-semibold transition-colors"
            :class="servers.sortField.value === 'name'
              ? 'bg-nord-bg-active border-app-accent text-white'
              : 'border-app-border hover:bg-nord-bg-hover'"
            @click="servers.toggleSort('name')"
          >
            <span>A-Z</span>
            <Icon
              v-if="servers.sortField.value === 'name'"
              :name="servers.sortOrder.value === 'asc' ? 'sortAsc' : 'sortDesc'"
              class="w-4 h-4"
            />
          </button>

          <div class="px-3 py-1.5 rounded bg-app-bg/50 border border-app-border/50">
            <span class="text-xs text-nord-text-secondary font-semibold">
              {{ servers.serverCount.value }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>