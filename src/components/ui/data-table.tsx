"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, RefreshCcw } from "lucide-react"
import { ActionMenu, type ActionMenuGroup, type ActionMenuItem } from "@/components/ui/action-menu"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/core/utils"

type DataTableRowKey<TData> = keyof TData | ((row: TData, index: number) => React.Key)
type DataTableAlign = "left" | "center" | "right"
type DataTableDensity = "compact" | "comfortable" | "spacious"
type DataTableSortDirection = "asc" | "desc"
type DataTableBreakpoint = "sm" | "md" | "lg" | "xl" | "2xl"

type DataTableColumn<TData, TValue = unknown> = {
  id: string
  header: React.ReactNode | ((column: DataTableColumn<TData, TValue>) => React.ReactNode)
  accessor?: keyof TData | ((row: TData, index: number) => TValue)
  render?: (row: TData, index: number) => React.ReactNode
  align?: DataTableAlign
  sortable?: boolean
  width?: number | string
  priority?: number
  hideBelow?: DataTableBreakpoint
  className?: string | ((row: TData, index: number) => string | undefined)
  headerClassName?: string
}

type DataTableSelection<TData> = {
  selectedKeys: React.Key[]
  onSelectedKeysChange: (keys: React.Key[]) => void
  isRowDisabled?: (row: TData, index: number) => boolean
  getRowDisabledReason?: (row: TData, index: number) => string | undefined
  ariaLabel?: string
}

type DataTableSort = {
  columnId?: string
  direction?: DataTableSortDirection
  onSortChange?: (sort: { columnId: string; direction: DataTableSortDirection }) => void
}

type DataTablePagination = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  label?: React.ReactNode
}

type DataTableEmptyState = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  icon?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  primaryAction?: React.ReactNode
  secondaryAction?: React.ReactNode
}

type DataTableError = {
  title?: React.ReactNode
  message?: React.ReactNode
  retryLabel?: React.ReactNode
  onRetry?: () => void
  action?: React.ReactNode
}

type DataTableMobileFallback<TData> =
  | React.ReactNode
  | ((props: {
      rows: TData[]
      columns: DataTableColumn<TData>[]
      getRowKey: (row: TData, index: number) => React.Key
      selection?: DataTableSelection<TData>
      rowActions?: (row: TData, index: number) => ActionMenuGroup[]
      onRowClick?: (row: TData, index: number) => void
    }) => React.ReactNode)

type DataTableRowEnhancement = {
  rowProps?: React.HTMLAttributes<HTMLTableRowElement> & {
    ref?: React.Ref<HTMLTableRowElement>
  }
  leadingHeader?: React.ReactNode
  leadingHeaderClassName?: string
  leadingCell?: React.ReactNode
  leadingCellClassName?: string
}

type DataTableRowEnhancerProps<TData> = {
  row: TData
  rowIndex: number
  rowKey: React.Key
  selected: boolean
  disabled: boolean
  children: (enhancement?: DataTableRowEnhancement) => React.ReactNode
}

type DataTableRowEnhancer<TData> = React.ComponentType<DataTableRowEnhancerProps<TData>>

type DataTableProps<TData> = {
  columns: DataTableColumn<TData>[]
  rows: TData[]
  rowKey: DataTableRowKey<TData>
  selection?: DataTableSelection<TData>
  sort?: DataTableSort
  pagination?: DataTablePagination
  loading?: boolean
  loadingRowCount?: number
  error?: DataTableError | React.ReactNode
  emptyState?: DataTableEmptyState | React.ReactNode
  onRowClick?: (row: TData, index: number) => void
  rowActions?: (row: TData, index: number) => ActionMenuGroup[]
  rowEnhancer?: DataTableRowEnhancer<TData>
  density?: DataTableDensity
  stickyHeader?: boolean
  mobileFallback?: DataTableMobileFallback<TData>
  className?: string
  tableClassName?: string
  "aria-label"?: string
}

const alignClassName: Record<DataTableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

const hideBelowClassName: Record<DataTableBreakpoint, string> = {
  sm: "max-sm:hidden",
  md: "max-md:hidden",
  lg: "max-lg:hidden",
  xl: "max-xl:hidden",
  "2xl": "max-2xl:hidden",
}

const densityCellClassName: Record<DataTableDensity, string> = {
  compact: "py-2",
  comfortable: "py-3",
  spacious: "py-4",
}

const densityRowClassName: Record<DataTableDensity, string> = {
  compact: "min-h-10",
  comfortable: "min-h-12",
  spacious: "min-h-14",
}

function getResponsiveColumnClassName<TData>(column: DataTableColumn<TData>) {
  if (column.hideBelow) return hideBelowClassName[column.hideBelow]
  if (typeof column.priority !== "number") return undefined
  if (column.priority >= 4) return "max-lg:hidden"
  if (column.priority >= 3) return "max-md:hidden"
  if (column.priority >= 2) return "max-sm:hidden"
  return undefined
}

function getCellClassName<TData>(
  column: DataTableColumn<TData>,
  row: TData,
  index: number
) {
  return typeof column.className === "function" ? column.className(row, index) : column.className
}

function getRowKey<TData>(rowKey: DataTableRowKey<TData>, row: TData, index: number) {
  return typeof rowKey === "function" ? rowKey(row, index) : (row[rowKey] as React.Key)
}

function getColumnValue<TData>(column: DataTableColumn<TData>, row: TData, index: number) {
  if (column.render) return column.render(row, index)
  if (typeof column.accessor === "function") return column.accessor(row, index) as React.ReactNode
  if (column.accessor) return row[column.accessor] as React.ReactNode
  return null
}

function getNextSortDirection(current?: DataTableSortDirection): DataTableSortDirection {
  return current === "asc" ? "desc" : "asc"
}

function renderHeader<TData>(column: DataTableColumn<TData>) {
  return typeof column.header === "function" ? column.header(column) : column.header
}

function renderError(error: DataTableError | React.ReactNode) {
  if (!error || !isDataTableError(error)) return error

  const action = error.action ?? (
    error.onRetry ? (
      <Button type="button" variant="outline" size="sm" onClick={error.onRetry}>
        <RefreshCcw className="mr-2 h-4 w-4" />
        {error.retryLabel ?? "Retry"}
      </Button>
    ) : null
  )

  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-10 text-center">
      <div className="text-sm font-semibold text-foreground">{error.title ?? "Unable to load data"}</div>
      {error.message ? <div className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error.message}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function isDataTableError(error: DataTableError | React.ReactNode): error is DataTableError {
  return typeof error === "object" && error !== null && !React.isValidElement(error)
}

function isEmptyStateObject(emptyState: DataTableEmptyState | React.ReactNode): emptyState is DataTableEmptyState {
  return typeof emptyState === "object" && emptyState !== null && !React.isValidElement(emptyState)
}

function renderEmptyState(emptyState?: DataTableEmptyState | React.ReactNode) {
  if (!emptyState) return <EmptyState title="No data" description="There are no rows to show yet." />
  if (!isEmptyStateObject(emptyState)) return emptyState

  const { title = "No data", ...props } = emptyState
  return <EmptyState title={title as string} {...props} />
}

function getActionSignature(action: ActionMenuItem) {
  return `${action.id}:${String(action.label)}`
}

function getInlineRowAction(groups: ActionMenuGroup[]) {
  const regularActions = groups
    .flatMap((group) => group.actions)
    .filter((action) => !action.destructive && action.inline !== false)
  return (
    regularActions.find((action) => action.primary) ??
    regularActions.find((action) => !action.disabled) ??
    regularActions[0] ??
    null
  )
}

function getOverflowActionGroups(groups: ActionMenuGroup[], inlineAction: ActionMenuItem | null) {
  if (!inlineAction) return groups

  const inlineSignature = getActionSignature(inlineAction)
  return groups
    .map((group) => ({
      ...group,
      actions: group.actions.filter((action) => getActionSignature(action) !== inlineSignature),
    }))
    .filter((group) => group.actions.length > 0)
}

function renderInlineRowAction(action: ActionMenuItem) {
  const label = action.label
  const content = (
    <>
      {action.icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{action.icon}</span> : null}
      <span className={cn("truncate", action.icon && "max-lg:sr-only")}>{label}</span>
    </>
  )

  const className = "h-8 max-w-[8.5rem] gap-1.5 rounded-md px-2.5 text-xs"

  if (action.href && !action.disabled) {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <a
          href={action.href}
          target={action.target}
          rel={action.rel ?? (action.target === "_blank" ? "noreferrer" : undefined)}
          onClick={(event) => {
            event.stopPropagation()
            action.onSelect?.()
          }}
        >
          {content}
        </a>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={action.disabled}
      title={typeof action.disabledReason === "string" ? action.disabledReason : undefined}
      className={className}
      onClick={(event) => {
        event.stopPropagation()
        if (action.disabled) return
        action.onSelect?.()
      }}
    >
      {content}
    </Button>
  )
}

function DataTable<TData>({
  columns,
  rows,
  rowKey,
  selection,
  sort,
  pagination,
  loading,
  loadingRowCount = 5,
  error,
  emptyState,
  onRowClick,
  rowActions,
  rowEnhancer: RowEnhancer,
  density = "comfortable",
  stickyHeader,
  mobileFallback,
  className,
  tableClassName,
  "aria-label": ariaLabel,
}: DataTableProps<TData>) {
  const keyForRow = React.useCallback(
    (row: TData, index: number) => getRowKey(rowKey, row, index),
    [rowKey]
  )
  const selectedKeySet = React.useMemo(() => new Set(selection?.selectedKeys ?? []), [selection?.selectedKeys])
  const selectableRowKeys = React.useMemo(() => {
    if (!selection) return []
    return rows
      .map((row, index) => ({
        key: keyForRow(row, index),
        disabled: selection.isRowDisabled?.(row, index) ?? false,
      }))
      .filter((item) => !item.disabled)
      .map((item) => item.key)
  }, [keyForRow, rows, selection])
  const selectedSelectableCount = selectableRowKeys.filter((key) => selectedKeySet.has(key)).length
  const allSelected = selectableRowKeys.length > 0 && selectedSelectableCount === selectableRowKeys.length
  const partiallySelected = selectedSelectableCount > 0 && !allSelected
  const hasRowActions = Boolean(rowActions)
  const hasLeadingColumn = Boolean(RowEnhancer)
  const visibleColumnCount = columns.length + (hasLeadingColumn ? 1 : 0) + (selection ? 1 : 0) + (hasRowActions ? 1 : 0)

  const setRowSelected = (key: React.Key, checked: boolean) => {
    if (!selection) return
    const next = new Set(selection.selectedKeys)
    if (checked) next.add(key)
    else next.delete(key)
    selection.onSelectedKeysChange(Array.from(next))
  }

  const setAllSelected = (checked: boolean) => {
    if (!selection) return
    const next = new Set(selection.selectedKeys)
    selectableRowKeys.forEach((key) => {
      if (checked) next.add(key)
      else next.delete(key)
    })
    selection.onSelectedKeysChange(Array.from(next))
  }

  const mobileContent =
    typeof mobileFallback === "function"
      ? mobileFallback({ rows, columns, getRowKey: keyForRow, selection, rowActions, onRowClick })
      : mobileFallback

  if (error) {
    return <div className={cn("w-full", className)}>{renderError(error)}</div>
  }

  if (!loading && rows.length === 0) {
    return <div className={cn("w-full", className)}>{renderEmptyState(emptyState)}</div>
  }

  return (
    <div className={cn("w-full", className)}>
      {mobileContent ? <div className="md:hidden">{mobileContent}</div> : null}
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-card shadow-none",
          mobileContent && "hidden md:block"
        )}
      >
        <Table aria-label={ariaLabel} className={cn("bg-card", tableClassName)}>
          <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-card")}>
            <TableRow className="hover:bg-transparent">
              {hasLeadingColumn ? <TableHead className="w-10 px-3" aria-label="Row controls" /> : null}
              {selection ? (
                <TableHead className="w-11 px-3">
                  <Checkbox
                    aria-label={selection.ariaLabel ?? "Select all rows"}
                    checked={allSelected ? true : partiallySelected ? "indeterminate" : false}
                    disabled={selectableRowKeys.length === 0}
                    onCheckedChange={(checked) => setAllSelected(checked === true)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </TableHead>
              ) : null}
              {columns.map((column) => {
                const sorted = sort?.columnId === column.id ? sort.direction : undefined
                const align = column.align ?? "left"
                return (
                  <TableHead
                    key={column.id}
                    style={{ width: column.width }}
                    className={cn(
                      alignClassName[align],
                      getResponsiveColumnClassName(column),
                      stickyHeader && "bg-card",
                      column.headerClassName
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md text-xs font-medium uppercase text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                          align === "right" && "ml-auto",
                          align === "center" && "mx-auto"
                        )}
                        onClick={() => {
                          sort?.onSortChange?.({
                            columnId: column.id,
                            direction: sort?.columnId === column.id ? getNextSortDirection(sort.direction) : "asc",
                          })
                        }}
                      >
                        {renderHeader(column)}
                        {sorted === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
                        )}
                      </button>
                    ) : (
                      renderHeader(column)
                    )}
                  </TableHead>
                )
              })}
              {hasRowActions ? <TableHead className="w-40 px-3 text-right" aria-label="Row actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: loadingRowCount }).map((_, rowIndex) => (
                  <TableRow key={`skeleton-${rowIndex}`} className={densityRowClassName[density]}>
                    {hasLeadingColumn ? (
                      <TableCell className={cn("w-10 px-3", densityCellClassName[density])}>
                        <Skeleton className="h-4 w-4 rounded-sm" />
                      </TableCell>
                    ) : null}
                    {selection ? (
                      <TableCell className={cn("px-3", densityCellClassName[density])}>
                        <Skeleton className="h-4 w-4 rounded-sm" />
                      </TableCell>
                    ) : null}
                    {columns.map((column, columnIndex) => (
                      <TableCell
                        key={column.id}
                        className={cn(
                          densityCellClassName[density],
                          getResponsiveColumnClassName(column)
                        )}
                      >
                        <Skeleton className={cn("h-4", columnIndex === 0 ? "w-2/3" : "w-1/2")} />
                      </TableCell>
                    ))}
                    {hasRowActions ? (
                      <TableCell className={cn("px-3", densityCellClassName[density])}>
                        <Skeleton className="ml-auto h-8 w-28 rounded-md" />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              : rows.map((row, rowIndex) => {
                  const key = keyForRow(row, rowIndex)
                  const selected = selectedKeySet.has(key)
                  const rowDisabled = selection?.isRowDisabled?.(row, rowIndex) ?? false
                  const actions = rowActions?.(row, rowIndex) ?? []
                  const inlineAction = getInlineRowAction(actions)
                  const overflowActions = getOverflowActionGroups(actions, inlineAction)

                  const renderRow = (enhancement?: DataTableRowEnhancement) => {
                    const {
                      rowProps,
                      leadingCell,
                      leadingCellClassName,
                    } = enhancement ?? {}
                    const {
                      className: enhancedClassName,
                      onClick: enhancedOnClick,
                      onKeyDown: enhancedOnKeyDown,
                      ...enhancedRowProps
                    } = rowProps ?? {}

                    return (
                    <TableRow
                      key={key}
                      data-state={selected ? "selected" : undefined}
                      className={cn(
                        densityRowClassName[density],
                        onRowClick && "cursor-pointer hover:bg-muted/35",
                        enhancedClassName
                      )}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={(event) => {
                        enhancedOnClick?.(event)
                        if (!event.defaultPrevented) onRowClick?.(row, rowIndex)
                      }}
                      onKeyDown={(event) => {
                        enhancedOnKeyDown?.(event)
                        if (event.defaultPrevented) return
                        if (!onRowClick) return
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onRowClick(row, rowIndex)
                        }
                      }}
                      {...enhancedRowProps}
                    >
                      {hasLeadingColumn ? (
                        <TableCell className={cn("w-10 px-3", densityCellClassName[density], leadingCellClassName)}>
                          {leadingCell}
                        </TableCell>
                      ) : null}
                      {selection ? (
                        <TableCell className={cn("px-3", densityCellClassName[density])}>
                          <Checkbox
                            aria-label={`Select row ${rowIndex + 1}`}
                            title={selection.getRowDisabledReason?.(row, rowIndex)}
                            checked={selected}
                            disabled={rowDisabled}
                            onCheckedChange={(checked) => setRowSelected(key, checked === true)}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </TableCell>
                      ) : null}
                      {columns.map((column) => {
                        const align = column.align ?? "left"
                        return (
                          <TableCell
                            key={column.id}
                            style={{ width: column.width }}
                            className={cn(
                              densityCellClassName[density],
                              alignClassName[align],
                              getResponsiveColumnClassName(column),
                              getCellClassName(column, row, rowIndex)
                            )}
                          >
                            {getColumnValue(column, row, rowIndex)}
                          </TableCell>
                        )
                      })}
                      {hasRowActions ? (
                        <TableCell className={cn("px-3 text-right", densityCellClassName[density])}>
                          <div className="flex items-center justify-end gap-1.5">
                            {inlineAction ? renderInlineRowAction(inlineAction) : null}
                            <ActionMenu actions={overflowActions} />
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                    )
                  }

                  if (RowEnhancer) {
                    return (
                      <RowEnhancer
                        key={key}
                        row={row}
                        rowIndex={rowIndex}
                        rowKey={key}
                        selected={selected}
                        disabled={rowDisabled}
                      >
                        {renderRow}
                      </RowEnhancer>
                    )
                  }

                  return renderRow()
                })}
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="py-0">
                  {renderEmptyState(emptyState)}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {pagination ? (
        <div className="flex flex-col gap-3 border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {pagination.label ??
              `Page ${pagination.page} of ${Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}`}
          </div>
          <Pagination className="mx-0 w-auto justify-start sm:justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={pagination.page <= 1}
                  onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  disabled={pagination.page >= Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}
                  onClick={() =>
                    pagination.onPageChange(
                      Math.min(Math.max(1, Math.ceil(pagination.total / pagination.pageSize)), pagination.page + 1)
                    )
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </div>
  )
}

export { DataTable }
export type {
  DataTableAlign,
  DataTableBreakpoint,
  DataTableColumn,
  DataTableDensity,
  DataTableEmptyState,
  DataTableError,
  DataTableMobileFallback,
  DataTablePagination,
  DataTableProps,
  DataTableRowEnhancement,
  DataTableRowEnhancer,
  DataTableRowEnhancerProps,
  DataTableRowKey,
  DataTableSelection,
  DataTableSort,
  DataTableSortDirection,
}
