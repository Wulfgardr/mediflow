import 'server-only';
import { dbServer } from './db-server';
import { createNativePatientDocumentService } from './native-patient-document';

export const nativePatientDocumentService = createNativePatientDocumentService(dbServer);
