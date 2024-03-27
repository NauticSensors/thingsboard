///
/// Copyright © 2016-2024 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  forwardRef,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewContainerRef
} from '@angular/core';
import { PageComponent } from '@shared/components/page.component';
import { PageLink } from '@shared/models/page/page-link';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { DialogService } from '@core/services/dialog.service';
import { Direction, SortOrder } from '@shared/models/page/sort-order';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, take, takeUntil, tap } from 'rxjs/operators';
import { Overlay } from '@angular/cdk/overlay';
import { UtilsService } from '@core/services/utils.service';
import { EntityService } from '@core/http/entity.service';
import { ControlValueAccessor, FormArray, FormBuilder, NG_VALUE_ACCESSOR, UntypedFormArray } from '@angular/forms';
import {
  ConvertorTypeTranslationsMap,
  MappingTypes,
  MappingTypeTranslationsMap,
  RequestTypes
} from '@home/components/widget/lib/gateway/gateway-widget.models';
import { CollectionViewer, DataSource, SelectionModel } from '@angular/cdk/collections';
import { MappingDialogComponent } from '@home/components/widget/lib/gateway/dialog/mapping-dialog.component';
import { isDefinedAndNotNull, isUndefinedOrNull } from '@core/utils';

@Component({
  selector: 'tb-mapping-table',
  templateUrl: './mapping-table.component.html',
  styleUrls: ['./mapping-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MappingTableComponent),
      multi: true
    }
  ]
})
export class MappingTableComponent extends PageComponent implements ControlValueAccessor, AfterViewInit, OnInit, OnDestroy {

  mappingTypeTranslationsMap = MappingTypeTranslationsMap;
  displayedColumns = [];
  mappingColumns = [];
  textSearchMode = false;
  dataSource: MappingDatasource;
  hidePageSize = false;

  activeValue = false;
  dirtyValue = false;

  viewsInited = false;

  mappingTypeValue: MappingTypes;

  get mappingType(): MappingTypes {
    return this.mappingTypeValue;
  }

  @Input()
  set mappingType(value: MappingTypes) {
    if (this.mappingTypeValue !== value) {
      this.mappingTypeValue = value;
    }
  }

  @ViewChild('searchInput') searchInputField: ElementRef;

  // @ViewChild(MatPaginator) paginator: MatPaginator;
  // @ViewChild(MatSort) sort: MatSort;

  mappingFormGroup: UntypedFormArray;
  textSearch = this.fb.control('', {nonNullable: true});

  private destroy$ = new Subject<void>();
  private propagateChange = (v: any) => {};

  constructor(protected store: Store<AppState>,
              public translate: TranslateService,
              public dialog: MatDialog,
              private overlay: Overlay,
              private viewContainerRef: ViewContainerRef,
              private dialogService: DialogService,
              private entityService: EntityService,
              private utils: UtilsService,
              private zone: NgZone,
              private cd: ChangeDetectorRef,
              private elementRef: ElementRef,
              private fb: FormBuilder) {
    super(store);
    this.mappingFormGroup = this.fb.array([]);
    this.dirtyValue = !this.activeValue;
    // const sortOrder: SortOrder = { property: 'key', direction: Direction.ASC };
    this.dataSource = new MappingDatasource();
  }

  ngOnInit() {
    if (this.mappingType === MappingTypes.DATA) {
      this.mappingColumns.push(
        {def: 'topicFilter', title: 'gateway.topic-filter'},
        {def: 'QoS', title: 'gateway.mqtt-qos'},
        {def: 'converter', title: 'gateway.converter'}
      )
    } else {
      this.mappingColumns.push(
        {def: 'type', title: 'gateway.type'},
        {def: 'details', title: 'gateway.details'}
      );
    }
    this.displayedColumns.push(...this.mappingColumns.map(column => column.def), 'actions');
    this.mappingFormGroup.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe((value) => {
      this.updateTableData(value);
      this.updateView(value);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit() {
    this.textSearch.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged((prev, current) => (prev ?? '') === current.trim()),
      takeUntil(this.destroy$)
    ).subscribe((text) => {
      const searchText = text.trim();
      this.updateTableData(this.mappingFormGroup.value, searchText.trim())
    });
  }

  registerOnChange(fn: any): void {
    this.propagateChange = fn;
  }

  registerOnTouched(fn: any): void {}

  writeValue(config: any) {
    if (isUndefinedOrNull(config)) {
      config = this.mappingType === MappingTypes.REQUESTS ? {} : [];
    }
    let mappingConfigs = config;
    if (this.mappingType === MappingTypes.REQUESTS) {
      mappingConfigs = [];

      Object.keys(config).forEach((configKey) => {
        for (let mapping of config[configKey]) {
          mappingConfigs.push({
            requestType: configKey,
            requestValue: mapping
          });
        }
      });
    }
    this.mappingFormGroup.clear({emitEvent: false});
    for (let mapping of mappingConfigs) {
      this.mappingFormGroup.push(this.fb.group(mapping), {emitEvent: false});
    }
    this.updateTableData(mappingConfigs);
  }

  updateView(mappingConfigs: Array<any>) {
    let config;
    if (this.mappingType === MappingTypes.REQUESTS) {
      config = {};
      for (let mappingConfig of mappingConfigs) {
        if (config[mappingConfig.requestType]) {
          config[mappingConfig.requestType].push(mappingConfig.requestValue);
        } else {
          config[mappingConfig.requestType] = [mappingConfig.requestValue];
        }
      }
    } else {
      config = mappingConfigs;
    }

    this.propagateChange(config);
  }

  enterFilterMode() {
    this.textSearchMode = true;
    setTimeout(() => {
      this.searchInputField.nativeElement.focus();
      this.searchInputField.nativeElement.setSelectionRange(0, 0);
    }, 10);
  }

  exitFilterMode() {
    this.textSearchMode = false;
    this.textSearch.reset();
  }

  manageMapping($event: Event, index?: number) {
    if ($event) {
      $event.stopPropagation();
    }
    const value = isDefinedAndNotNull(index) ? this.mappingFormGroup.at(index).value : {};
    this.dialog.open<MappingDialogComponent, any, boolean>(MappingDialogComponent, {
      disableClose: true,
      panelClass: ['tb-dialog', 'tb-fullscreen-dialog'],
      data: {
        mappingType: this.mappingType,
        value,
        buttonTitle: isUndefinedOrNull(index) ?  'action.add' : 'action.apply'
      }
    }).afterClosed().subscribe(
      (res) => {
        if (res) {
          if (isDefinedAndNotNull(index)) {
            this.mappingFormGroup.at(index).patchValue(res);
          } else {
            this.mappingFormGroup.push(this.fb.group(res));
          }
        }
      }
    );
  }

  updateTableData(value, textSearch?: string): void {
    let tableValue = value;
    if (this.mappingType === MappingTypes.DATA) {
      tableValue = tableValue.map((value) => {
        return {
          topicFilter: value.topicFilter,
          QoS: value.subscriptionQos,
          converter: this.translate.instant(ConvertorTypeTranslationsMap.get(value.converter.type))
        };
      });
    } else {
      tableValue = tableValue.map((value) => {
        let details;
        if (value.requestType === RequestTypes.ATTRIBUTE_UPDATE) {
          details = value.requestValue.attributeFilter;
        } else if (value.requestType === RequestTypes.SERVER_SIDE_RPC) {
          details = value.requestValue.methodFilter;
        } else {
          details = value.requestValue.topicFilter;
        }
        return {
          type: value.requestType,
          details
        };
      });
    }
    if (textSearch) {
      tableValue = tableValue.filter(value =>
        Object.values(value).some(val =>
          val.toString().toLowerCase().includes(textSearch.toLowerCase())
        )
      );
    }
    this.dataSource.loadMappings(tableValue);
  }

  deleteMapping($event: Event, index: number) {
    if ($event) {
      $event.stopPropagation();
    }
    this.dialogService.confirm(
      this.translate.instant('gateway.delete-mapping-title'),
      '',
      this.translate.instant('action.no'),
      this.translate.instant('action.yes'),
      true
    ).subscribe((result) => {
      if (result) {
        this.mappingFormGroup.removeAt(index);
      }
    });
  }

}

export class MappingDatasource implements DataSource<any> {

  private mappingSubject = new BehaviorSubject<any[]>([]);

  private allMappings: Observable<Array<any>>;

  constructor() {}

  connect(collectionViewer: CollectionViewer): Observable<any[] | ReadonlyArray<any>> {
    return this.mappingSubject.asObservable();
  }

  disconnect(collectionViewer: CollectionViewer): void {
    this.mappingSubject.complete();
  }

  loadMappings(mappings: any, pageLink?: PageLink, reload: boolean = false): void {
    if (reload) {
      this.allMappings = null;
    }
    this.mappingSubject.next(mappings);
  }

  isEmpty(): Observable<boolean> {
    return this.mappingSubject.pipe(
      map((mappings) => !mappings.length)
    );
  }

  total(): Observable<number> {
    return this.mappingSubject.pipe(
      map((mappings) => mappings.length)
    );
  }

}
