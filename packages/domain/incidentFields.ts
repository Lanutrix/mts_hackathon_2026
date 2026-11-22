export const FIELDS =
  "sysId,id,state,stateEnum,stateId,stateReason,stateReasonId,submitDate,deadline,completionDate,lastAssignmentToTeamDateTime,header,description,shortDescription,assignedGroupName,assignedEmployee,assignedEmployeeLogin,initiatorName,initiatorLogin,isEffect,isReason,isDouble,isMaster,incType,serviceTypeId,serviceType,priorityId,priority,urgencyId,urgency,impactId,impact,waitingExitDate,isRootIncident,productName,productId,productMasterId,productUrl,service,serviceId,scenarioName,isNeedUp,eliminationType,eliminationTypeId,receivingChannel,solution".split(
    ",",
  );
export const STATES: Record<number, { enum: string; label: string }> = {
  0: { enum: "Assigned", label: "Назначен" },
  2: { enum: "WorkInProgress", label: "Выполняется" },
  7: { enum: "Resolved", label: "Завершён" },
  10: { enum: "Closed", label: "Закрыт" },
  20: { enum: "Research", label: "Исследование ситуации" },
};
export const PRIORITIES: Record<number, string> = {
  1: "Низкий",
  2: "Средний",
  3: "Высокий",
  4: "Наивысший",
};
