export interface TransferTarget {
  codeHash: string
  newDeviceId: string
  newDeviceSuffix: string
}

export interface ApprovedTransferOptions extends TransferTarget {
  oldDeviceId: string
  activationId: string
  nowIso: string
  year: number
}

export function transferTarget(code: string, requestCode: string): TransferTarget
export function buildApprovedTransferSql(options: ApprovedTransferOptions): string
