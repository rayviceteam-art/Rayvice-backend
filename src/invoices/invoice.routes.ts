import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateRequest } from '../middleware/validateRequest';
import {
  generateInvoiceSchema,
  listInvoicesSchema,
  invoiceIdSchema,
  resendInvoiceSchema,
  markPaidSchema,
  rejectInvoiceSchema,
  cancelInvoiceSchema,
  prodaExportSchema,
} from './invoice.validators';
import * as controller from './invoice.controller';

const router = Router();

router.use(authenticate);

// Order matters: /proda-export must be registered before /:id routes.
router.get('/proda-export', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(prodaExportSchema), controller.exportProdaCsv);

router.post('/generate', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(generateInvoiceSchema), controller.generateInvoice);
router.get('/', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(listInvoicesSchema), controller.listInvoices);
router.get('/:id', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(invoiceIdSchema), controller.getInvoice);
router.get('/:id/pdf', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(invoiceIdSchema), controller.getInvoicePdf);
router.post('/:id/resend', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(resendInvoiceSchema), controller.resendInvoice);
router.post('/:id/mark-paid', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(markPaidSchema), controller.markInvoicePaid);
router.post('/:id/reject', authorize('OWNER', 'OFFICE_MANAGER'), validateRequest(rejectInvoiceSchema), controller.rejectInvoice);
router.post('/:id/cancel', authorize('OWNER'), validateRequest(cancelInvoiceSchema), controller.cancelInvoice);

export default router;
