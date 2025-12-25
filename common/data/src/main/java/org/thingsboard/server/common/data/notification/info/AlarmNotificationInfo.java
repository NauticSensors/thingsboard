/**
 * Copyright © 2016-2025 The Thingsboard Authors
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
package org.thingsboard.server.common.data.notification.info;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.thingsboard.server.common.data.alarm.AlarmSeverity;
import org.thingsboard.server.common.data.alarm.AlarmStatus;
import org.thingsboard.server.common.data.id.CustomerId;
import org.thingsboard.server.common.data.id.DashboardId;
import org.thingsboard.server.common.data.id.EntityId;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AlarmNotificationInfo implements RuleOriginatedNotificationInfo {

    private String alarmType;
    private String action;
    private UUID alarmId;
    private EntityId alarmOriginator;
    private String alarmOriginatorName;
    private String alarmOriginatorLabel;
    private AlarmSeverity alarmSeverity;
    private AlarmStatus alarmStatus;
    private boolean acknowledged;
    private boolean cleared;
    private CustomerId alarmCustomerId;
    private DashboardId dashboardId;
    private JsonNode alarmDetails;

    @Override
    public Map<String, String> getTemplateData() {
        Map<String, String> data = new HashMap<>();
        data.put("alarmType", alarmType);
        data.put("action", action);
        data.put("alarmId", alarmId.toString());
        data.put("alarmSeverity", alarmSeverity.name().toLowerCase());
        data.put("alarmStatus", alarmStatus.toString());
        data.put("alarmOriginatorEntityType", alarmOriginator.getEntityType().getNormalName());
        data.put("alarmOriginatorName", alarmOriginatorName);
        data.put("alarmOriginatorLabel", alarmOriginatorLabel != null ? alarmOriginatorLabel : alarmOriginatorName);
        data.put("alarmOriginatorId", alarmOriginator.getId().toString());

        // Add alarm details as template variables with "alarmDetails." prefix
        if (alarmDetails != null) {
            // Check if there's a "data" field containing the JSON string
            JsonNode dataNode = alarmDetails.get("data");
            if (dataNode != null && dataNode.isTextual()) {
                try {
                    ObjectMapper mapper = new ObjectMapper();
                    JsonNode parsedData = mapper.readTree(dataNode.asText());
                    addJsonNodeToTemplateData(data, "alarmDetails", parsedData);
                } catch (Exception e) {
                    // If parsing fails, use the raw data string
                    data.put("alarmDetails.data", dataNode.asText());
                }
            } else {
                addJsonNodeToTemplateData(data, "alarmDetails", alarmDetails);
            }
        }

        return data;
    }

    private void addJsonNodeToTemplateData(Map<String, String> data, String prefix, JsonNode node) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String key = prefix + "." + field.getKey();
                JsonNode value = field.getValue();
                if (value.isValueNode()) {
                    data.put(key, value.asText());
                } else if (value.isObject()) {
                    addJsonNodeToTemplateData(data, key, value);
                }
            }
        } else if (node.isValueNode()) {
            data.put(prefix, node.asText());
        }
    }

    @Override
    public CustomerId getAffectedCustomerId() {
        return alarmCustomerId;
    }

    @Override
    public EntityId getStateEntityId() {
        return alarmOriginator;
    }

    @Override
    public DashboardId getDashboardId() {
        return dashboardId;
    }

}
