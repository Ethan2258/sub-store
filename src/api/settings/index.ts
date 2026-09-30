import request from '@/api';
import { AxiosPromise } from 'axios';

export function useSettingsApi() {
  return {
    getSettings: (signal?: AbortSignal): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/settings',
        method: 'get',
        signal,
      });
    },
    setSettings: (data: SettingsPostData, signal?: AbortSignal): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/settings',
        method: 'patch',
        data,
        signal,
      });
    },
    syncSettings: (query: 'download' | 'upload', options?: GistBackupSyncOptions): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/utils/backup`,
        method: 'get',
        params: {
          action: query,
          keep: options?.keep?.join(','),
          encode: options?.encode,
          tokenStrategy: options?.tokenStrategy,
        }
      });
    },
    downloadBackup: (): AxiosPromise<Blob> => {
      return request({
        url: '/api/storage',
        method: 'get',
        responseType: 'blob',
      });
    },
    restoreSettings: (data: StoragePostData): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/storage',
        method: 'post',
        data,
      });
    },
  };
}
