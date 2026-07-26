trigger AccountTrigger on Account (before update, after update) {
    // static references to other participants
    AccountService.applyDefaults(Trigger.new);
    ContactSync handler = new ContactSync();
    handler.run(Trigger.newMap);
    List<Contact> related = [SELECT Id FROM Contact WHERE AccountId IN :Trigger.newMap.keySet()];
}
