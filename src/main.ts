import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import { zhHans } from 'vuetify/locale';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import App from './App.vue';
import './app.css';

const vuetify = createVuetify({
  locale: { locale: 'zhHans', messages: { zhHans } },
  theme: { defaultTheme: 'dark' },
  defaults: {
    VBtn: { elevation: 0, style: 'text-transform:none;letter-spacing:0;font-weight:500;' },
    VCard: { elevation: 0 },
    VTextField: { variant: 'outlined', density: 'comfortable', color: 'primary', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'comfortable', color: 'primary', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'comfortable', color: 'primary', hideDetails: 'auto' },
    VCombobox: { variant: 'outlined', density: 'comfortable', color: 'primary', hideDetails: 'auto' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable', color: 'primary', hideDetails: 'auto' },
    VSwitch: { color: 'primary', density: 'compact', hideDetails: true, inset: true },
    VCheckbox: { color: 'primary', density: 'compact', hideDetails: 'auto' },
    VTabs: { style: 'text-transform:none;letter-spacing:0' },
    VChip: { size: 'small' },
    VDataTable: { hover: true, density: 'compact' },
    VDataTableServer: { hover: true, density: 'compact' },
  },
});
createApp(App).use(vuetify).mount('#app');
