import { useTokensData } from './useTokensData';

export const useAdminTokensData = (openFluentNotification) =>
  useTokensData(openFluentNotification, {
    listEndpoint: '/api/admin/token/',
    searchEndpoint: null,
    updateEndpoint: '/api/admin/token/',
    deleteEndpoint: (id) => `/api/admin/token/${id}`,
    batchEndpoint: '/api/admin/token/batch',
    statusOnlyUpdate: false,
  });
