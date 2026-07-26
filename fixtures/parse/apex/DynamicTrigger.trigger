trigger DynamicTrigger on Opportunity (after insert) {
    // dynamic SOQL: target cannot be resolved statically
    String soql = 'SELECT Id FROM ' + objectName + ' WHERE IsWon = true';
    List<SObject> rows = Database.query(soql);
    Type handlerType = Type.forName(configuredHandler);
}
