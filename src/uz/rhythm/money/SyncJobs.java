package uz.rhythm.money;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

public final class SyncJobs {
    private static final int NOW = 3101, PERIODIC = 3102;
    private SyncJobs() {}
    public static void queue(Context context) {
        if (!SyncConfig.connected(context)) return;
        context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(NOW, new ComponentName(context, SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1500).setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).setPersisted(true).build());
    }
    public static void periodic(Context context) {
        if (!SyncConfig.connected(context)) return;
        context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(PERIODIC, new ComponentName(context, SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build());
    }
    public static void cancel(Context context) { JobScheduler jobs = context.getSystemService(JobScheduler.class); jobs.cancel(NOW); jobs.cancel(PERIODIC); }
}
