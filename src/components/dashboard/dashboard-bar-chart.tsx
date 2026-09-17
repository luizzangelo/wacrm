'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { XAxisTickContentProps } from 'recharts';
import { chartScale } from '@/lib/dashboard/chart-format';

export interface DashboardBarRow {
  label: string;
  value: number | null;
}

/** Full labels on multiple lines, never ellipsis or unreadable angled text. */
export function lossLabelLines(label: string): string[] {
  const lines: string[] = [];
  for (const word of label.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= 18)
      lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Existing Recharts library, explicit numeric domain/ticks and semantic colors. */
export function DashboardBarChart({
  rows,
  integer = false,
  axisFormat,
  tooltipFormat,
  noSamples,
}: {
  rows: DashboardBarRow[];
  integer?: boolean;
  axisFormat: (value: number) => string;
  tooltipFormat: (value: number) => string;
  noSamples: string;
}) {
  const maximum = Math.max(0, ...rows.map((r) => r.value ?? 0));
  const scale = chartScale(
    maximum,
    integer ? 1 : maximum > 0 && maximum < 1 ? 1 / 60 : 1
  );
  return (
    <div className="overflow-x-auto" tabIndex={0}>
      <div className={integer ? 'min-w-[1000px]' : 'min-w-[460px]'}>
        <ResponsiveContainer width="100%" height={integer ? 350 : 280}>
          <BarChart
            data={rows}
            margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
            accessibilityLayer
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              interval={0}
              tickLine={false}
              axisLine={false}
              height={integer ? 65 : 30}
              tick={
                integer
                  ? ({
                      x,
                      y,
                      payload,
                    }: XAxisTickContentProps) => (
                      <text
                        className="recharts-cartesian-axis-tick-value"
                        x={x}
                        y={Number(y ?? 0) + 12}
                        fill="var(--muted-foreground)"
                        fontSize={11}
                        textAnchor="middle"
                      >
                        {lossLabelLines(String(payload?.value ?? '')).map(
                          (line, index) => (
                            <tspan key={index} x={x} dy={index ? 14 : 0}>
                              {line}{' '}
                            </tspan>
                          )
                        )}
                      </text>
                    )
                  : { fill: 'var(--muted-foreground)', fontSize: 11 }
              }
            />
            <YAxis
              type="number"
              domain={[0, scale.ceiling]}
              ticks={scale.ticks}
              allowDecimals={!integer}
              width={70}
              tickFormatter={axisFormat}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
              content={({ active, label, payload }) => {
                if (!active) return null;
                const row = rows.find((r) => r.label === label);
                const value = row?.value ?? payload?.[0]?.value;
                return (
                  <div className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-lg">
                    <div className="font-medium">{label}</div>
                    <div className="mt-1">
                      {row?.value == null
                        ? noSamples
                        : tooltipFormat(Number(value))}
                    </div>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              fill="var(--primary)"
              radius={[4, 4, 0, 0]}
              maxBarSize={64}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
