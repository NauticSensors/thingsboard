/**
 * Copyright © 2016-2024 The Thingsboard Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.thingsboard.server.common.data;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
public class SystemInfoData {
    @Schema(description = "Service Id.")
    private String serviceId;
    @Schema(description = "Service type.")
    private String serviceType;
    @Schema(description = "CPU usage, in percent.")
    private Long cpuUsage;
    @Schema(description = "Total CPU usage.")
    private Long cpuCount;
    @Schema(description = "Memory usage, in percent.")
    private Long memoryUsage;
    @Schema(description = "Total memory in bytes.")
    private Long totalMemory;
    @Schema(description = "Disk usage, in percent.")
    private Long discUsage;
    @Schema(description = "Total disc space in bytes.")
    private Long totalDiscSpace;

}
