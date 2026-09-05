import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mioV268Transform from './mio-v268-transform.js'
import mioV268Hotfix from './mio-v268-hotfix.js'
import mioV272DraftingFormatting from './mio-v272-drafting-formatting.js'
import mioV274DraftingLayout from './mio-v274-drafting-layout.js'
import mioV275DraftingEditor from './mio-v275-drafting-editor.js'
import mioV276AutofillPicker from './mio-v276-autofill-picker.js'
import mioV277CloudPersistence from './mio-v277-cloud-persistence.js'
import mioV279WithdrawalDashboard from './mio-v279-withdrawal-dashboard.js'
import mioV278DraftingComponents from './mio-v278-drafting-components.js'
import mioV280DraftingDocumentSetup from './mio-v280-drafting-document-setup.js'
import mioV281DraftingBlocks from './mio-v281-drafting-blocks.js'
import mioV283WithdrawalClarity from './mio-v283-withdrawal-clarity.js'
import mioV284DraftingStructuralDelete from './mio-v284-drafting-structural-delete.js'
import mioV287DraftingReadiness from './mio-v287-drafting-readiness.js'
import mioV290DraftingCollapse from './mio-v290-drafting-collapse.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [mioV268Transform(), mioV268Hotfix(), mioV272DraftingFormatting(), mioV274DraftingLayout(), mioV275DraftingEditor(), mioV276AutofillPicker(), mioV277CloudPersistence(), mioV278DraftingComponents(), mioV279WithdrawalDashboard(), mioV280DraftingDocumentSetup(), mioV281DraftingBlocks(), mioV283WithdrawalClarity(), mioV284DraftingStructuralDelete(), mioV287DraftingReadiness(), mioV290DraftingCollapse(), react()],
})