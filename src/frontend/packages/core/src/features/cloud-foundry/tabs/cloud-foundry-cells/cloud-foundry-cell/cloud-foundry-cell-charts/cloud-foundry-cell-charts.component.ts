import { Component } from '@angular/core';

import { MetricsConfig } from '../../../../../../shared/components/metrics-chart/metrics-chart.component';
import { MetricsLineChartConfig } from '../../../../../../shared/components/metrics-chart/metrics-chart.types';
import { MetricQueryType } from '../../../../../../shared/services/metrics-range-selector.types';
import { CloudFoundryCellService } from '../cloud-foundry-cell.service';
import { IMetricMatrixResult } from '../../../../../../../../store/src/types/base-metric.types';
import { IMetricCell } from '../../../../../../../../store/src/types/metric.types';

@Component({
  selector: 'app-cloud-foundry-cell-charts',
  templateUrl: './cloud-foundry-cell-charts.component.html',
  styleUrls: ['./cloud-foundry-cell-charts.component.scss'],
})
export class CloudFoundryCellChartsComponent {

  public metricConfigs: [
    MetricsConfig<IMetricMatrixResult<IMetricCell>>,
    MetricsLineChartConfig
  ][];

  constructor(public cfCellService: CloudFoundryCellService) {
    this.metricConfigs = [
      [
        this.cfCellService.buildMetricConfig('firehose_value_metric_rep_capacity_remaining_containers', MetricQueryType.RANGE_QUERY),
        {
          ...this.cfCellService.buildChartConfig('Containers Remaining'),
          yAxisTickFormatting: (label: string) => Math.round(Number(label)).toString()
        }
      ],
      [
        this.cfCellService.buildMetricConfig('firehose_value_metric_rep_capacity_remaining_memory', MetricQueryType.QUERY),
        this.cfCellService.buildChartConfig('Memory Remaining (MB)')
      ],
      [
        this.cfCellService.buildMetricConfig('firehose_value_metric_rep_capacity_remaining_disk', MetricQueryType.QUERY),
        this.cfCellService.buildChartConfig('Disk Remaining (MB)')
      ],
    ];

  }
}
