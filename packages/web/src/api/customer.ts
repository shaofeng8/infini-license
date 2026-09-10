import type { PageResult } from '@/types/base'
import type { Customer, CustomerPayload, CustomerQuery } from '@/types/customer'
import alovaInstance from '@/utils/http'

export const customerApi = {
  list: (params: CustomerQuery) =>
    alovaInstance.Get<PageResult<Customer>>('/customer/list', { params }),

  detail: (id: string) => alovaInstance.Get<Customer>(`/customer/${id}`),

  create: (data: CustomerPayload) =>
    alovaInstance.Post<Customer>('/customer', data),

  update: (id: string, data: CustomerPayload) =>
    alovaInstance.Put<Customer>(`/customer/${id}`, data),
}
